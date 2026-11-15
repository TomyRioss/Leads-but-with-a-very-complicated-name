import { NextResponse } from "next/server";
import { getCurrentUser, withRefreshedSession } from "@/lib/server/auth";
import { getUserLead } from "@/lib/server/lead-suite";
import { isClientId, isConversationInactive } from "@/lib/server/leadtita-conversations";
import { hasGmail } from "@/lib/server/google-connections";
import { isValidEmail } from "@/lib/server/google-gmail";
import { signPendingChange, type LeadSuiteAction } from "@/lib/server/lead-suite-agent";
import { getLeadWhatsApp, isWhatsAppConnected } from "@/lib/server/whatsapp";
import { isPocketBaseConfigured, pocketBaseFetch } from "@/lib/server/pocketbase";

const MAX_BODY = 5_000;
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  let session: Awaited<ReturnType<typeof getCurrentUser>>;
  try {
    session = await getCurrentUser(request);
  } catch {
    return json({ error: "account_unavailable" }, 503);
  }
  if (!session) return json({ error: "unauthorized" }, 401);
  if (!isPocketBaseConfigured()) return json({ error: "account_unavailable" }, 503);

  let body: { conversationId?: unknown; leadId?: unknown; channel?: unknown; subject?: unknown; text?: unknown };
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY) return json({ error: "invalid_request" }, 413);
    body = JSON.parse(raw);
  } catch {
    return json({ error: "invalid_request" }, 400);
  }

  if (!isClientId(body.conversationId) || typeof body.leadId !== "string" || !/^[a-zA-Z0-9]{15}$/.test(body.leadId)
    || (body.channel !== "whatsapp" && body.channel !== "email") || typeof body.text !== "string" || !body.text.trim() || body.text.length > 1500) {
    return json({ error: "invalid_request" }, 400);
  }
  try {
    if (await isConversationInactive(session.user.id, body.conversationId)) return json({ error: "conversation_inactive" }, 410);
    const lead = await getUserLead(session.user.id, body.leadId);
    if (!lead) return json({ error: "lead_not_found" }, 404);

    if (body.channel === "email") {
      const subject = typeof body.subject === "string" ? body.subject.trim() : "";
      if (!subject || subject.length > 200) return json({ error: "invalid_request" }, 400);
      if (!await hasGmail(session.user.id)) return json({ error: "needs_gmail" }, 409);
      const contact = await pocketBaseFetch<{ email?: string }>(`/api/collections/leads/records/${encodeURIComponent(lead.id)}?fields=email`);
      if (!contact.email || !isValidEmail(contact.email)) return json({ error: "recipient_missing" }, 409);
      const extra = { to: contact.email, subject, body: body.text.trim() };
      const token = signPendingChange({ uid: session.user.id, kind: "send_email", leadId: lead.id, leadName: lead.name, data: {}, extra });
      const action: LeadSuiteAction = { type: "pending_change", token, change: { kind: "send_email", leadName: lead.name, data: {}, extra } };
      return withRefreshedSession(json({ action }), session.token);
    }

    if (!await isWhatsAppConnected(session.user.id)) return json({ error: "needs_whatsapp" }, 409);
    const phone = await getLeadWhatsApp(session.user.id, lead.id);
    if (!phone) return json({ error: "recipient_missing" }, 409);
    const rows = [{ leadId: lead.id, leadName: lead.name, phone, text: body.text.trim() }];
    const extra = { count: 1, skipped: 0, preview: `${lead.name} · ${body.text.trim().slice(0, 60)}` };
    const token = signPendingChange({ uid: session.user.id, kind: "send_whatsapp_batch", leadId: "", leadName: "", data: {}, extra, rows });
    const action: LeadSuiteAction = { type: "pending_change", token, change: { kind: "send_whatsapp_batch", leadName: "", data: {}, extra } };
    return withRefreshedSession(json({ action }), session.token);
  } catch (error) {
    console.error("Lead Suite draft send proposal failed", error instanceof Error ? error.message : "unknown");
    return json({ error: "proposal_unavailable" }, 503);
  }
}
