import { ensureLeadContacted, getUserLead, listLeadContacts, recordLeadContact } from "@/lib/server/lead-suite";
import { isWorkerRequest } from "@/lib/server/whatsapp";
import { settleScheduledWhatsApp } from "@/lib/server/scheduled-messages";
import { json } from "../../google/_shared";

// Worker → app callbacks (shared secret, never a browser). Retried by the worker, so each effect is idempotent.

const ID = /^[a-zA-Z0-9]{15}$/;
const MAX_BODY_BYTES = 16_000;
const REPLY_NOTE_MAX = 500;
// Lead statuses a reply may move forward (never downgrade a meeting / won / lost).
const BEFORE_REPLY = new Set(["not_contacted", "contacted"]);

type WorkerEvent = { type?: unknown; userId?: unknown; leadId?: unknown; ref?: unknown; text?: unknown; at?: unknown; reason?: unknown };

function eventTime(value: unknown) {
  const date = new Date(typeof value === "string" ? value : "");
  return Number.isNaN(date.getTime()) || date.getTime() > Date.now() + 60_000 ? new Date().toISOString() : date.toISOString();
}

async function alreadyLogged(userId: string, leadId: string, fromIso: string, match: (contact: { message: string; status: string; channel: string }) => boolean) {
  const { items } = await listLeadContacts(userId, { leadId, from: fromIso, perPage: 20 });
  return items.some(match);
}

export async function POST(request: Request) {
  if (!isWorkerRequest(request)) return json({ error: "unauthorized" }, 401);
  let event: WorkerEvent;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return json({ error: "too_large" }, 413);
    event = JSON.parse(raw) as WorkerEvent;
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  const userId = typeof event.userId === "string" && ID.test(event.userId) ? event.userId : "";
  const leadId = typeof event.leadId === "string" && ID.test(event.leadId) ? event.leadId : "";
  if (!userId || !leadId) return json({ error: "invalid_body" }, 400);
  const at = eventTime(event.at);
  const since = new Date(new Date(at).getTime() - 10 * 60_000).toISOString();

  try {
    if (event.type === "sent") {
      const message = typeof event.text === "string" ? event.text.slice(0, 4000) : "";
      if (!message) return json({ error: "invalid_body" }, 400);
      const logged = await alreadyLogged(userId, leadId, since, (contact) => contact.channel === "whatsapp" && contact.message === message);
      if (!logged) {
        await recordLeadContact(userId, { leadId, channel: "whatsapp", message, contactedAt: at });
      } else await ensureLeadContacted(userId, leadId, at);
      if (typeof event.ref === "string") await settleScheduledWhatsApp(userId, event.ref, "sent", at);
      return json({ ok: true });
    }

    if (event.type === "replied") {
      const lead = await getUserLead(userId, leadId);
      if (!lead) return json({ ok: true, ignored: "lead_not_found" });
      if (!BEFORE_REPLY.has(lead.contactStatus)) return json({ ok: true, ignored: "status" });
      if (await alreadyLogged(userId, leadId, since, (contact) => contact.channel === "whatsapp" && contact.status === "replied")) return json({ ok: true });
      // The lead's text is untrusted data: stored as a plain note, never interpreted.
      const reply = typeof event.text === "string" ? event.text.trim().slice(0, REPLY_NOTE_MAX) : "";
      await recordLeadContact(userId, { leadId, channel: "whatsapp", status: "replied", message: "", notes: reply ? `Respuesta: ${reply}` : "", contactedAt: at });
      return json({ ok: true });
    }

    if (event.type === "failed") {
      console.warn("WhatsApp send failed", typeof event.reason === "string" ? event.reason.slice(0, 80) : "unknown");
      if (typeof event.ref === "string") await settleScheduledWhatsApp(userId, event.ref, "failed", at);
      return json({ ok: true });
    }

    return json({ error: "unknown_type" }, 400);
  } catch (error) {
    console.error("WhatsApp event failed", error instanceof Error ? error.message : "unknown");
    // 5xx so the worker retries.
    return json({ error: "event_failed" }, 503);
  }
}
