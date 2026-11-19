import { createHash, randomUUID } from "node:crypto";
import { pocketBaseFetch } from "@/lib/server/pocketbase";
import { getLeadPainBrief, getUserLead, recordLeadContact } from "@/lib/server/lead-suite";
import { GmailNotConnectedError, isValidEmail, sendGmail } from "@/lib/server/google-gmail";
import { hasGmail } from "@/lib/server/google-connections";
import { reserveGmailDailyUsage } from "@/lib/server/gmail-daily-usage";
import { enqueueWhatsApp, getLeadWhatsApp, getWhatsAppMessageStatus, getWhatsAppSession, isWhatsAppConnected, WhatsAppNotConnectedError, WHATSAPP_TEXT_MAX } from "@/lib/server/whatsapp";
import { getPlanLimits } from "@/lib/server/usage-limits";
import type { PendingPayload } from "@/lib/server/lead-suite-agent";

// "Programados": emails and WhatsApp messages scheduled from Leadtita cards. Rows live in PocketBase (server-only);
// /api/scheduled/dispatch, called every minute by the WhatsApp worker, sends the due ones through the same paths as
// an immediate send (Gmail daily quota, WhatsApp worker queue, Lead Suite contact log).

export type ScheduledChannel = "email" | "whatsapp";
export type ScheduledStatus = "scheduled" | "sending" | "queued" | "sent" | "delivered" | "failed" | "cancelled";
export type ScheduledMessage = { id: string; channel: ScheduledChannel; leadId: string; leadName: string; recipient: string; subject: string; body: string; sendAt: string; status: ScheduledStatus; error: string; sentAt: string };
type Row = { id: string; user: string; channel: ScheduledChannel; lead_id: string; lead_name?: string; recipient: string; subject?: string; body: string; send_at: string; status: ScheduledStatus; error?: string; sent_at?: string; updated?: string };

export const SCHEDULABLE_KINDS = new Set(["send_email", "send_email_batch", "send_whatsapp_batch"]);
const RECORDS = "/api/collections/scheduled_messages/records";
const ID = /^[a-zA-Z0-9]{15}$/;
const MIN_AHEAD_MS = 30_000;
const MAX_AHEAD_MS = 90 * 24 * 60 * 60_000;
const EMAIL_BODY_MAX = 5000;
const SUBJECT_MAX = 200;
const DUE_BATCH = 50;
// A row left in "sending" this long was interrupted mid-send: shown as failed so the user decides (it may have gone out).
const STALE_SENDING_MS = 10 * 60_000;

export class ScheduleError extends Error {
  // Plain field (no parameter property) so the file runs under node --experimental-strip-types.
  readonly code: "invalid_send_at" | "not_found" | "not_editable" | "invalid" | "recipient_missing" | "needs_gmail" | "needs_whatsapp" | "schedule_limit" | "whatsapp_monthly_limit";
  constructor(code: ScheduleError["code"]) { super(code); this.code = code; this.name = "ScheduleError"; }
}

const quote = (value: string) => JSON.stringify(value);
/** PocketBase stores and filters dates as "YYYY-MM-DD HH:MM:SS.sssZ". */
const pbDate = (iso: string) => iso.replace("T", " ");
const isoDate = (value?: string) => (value ? new Date(value.replace(" ", "T")).toISOString() : "");
const emailLog = (subject: string, body: string) => `${subject}\n\n${body}`.slice(0, 4000); // same format as leadtita-tools

function toMessage(row: Row): ScheduledMessage {
  return { id: row.id, channel: row.channel, leadId: row.lead_id, leadName: row.lead_name ?? "", recipient: row.recipient, subject: row.subject ?? "", body: row.body, sendAt: isoDate(row.send_at), status: row.status, error: row.error ?? "", sentAt: isoDate(row.sent_at) };
}

/** ISO date at least 30 s and at most 90 days ahead, or null. */
export function parseSendAt(value: unknown, now = Date.now()): string | null {
  if (typeof value !== "string" || value.length > 40) return null;
  const time = new Date(value).getTime();
  if (Number.isNaN(time) || time < now + MIN_AHEAD_MS || time > now + MAX_AHEAD_MS) return null;
  return new Date(time).toISOString();
}

/** Start of the current month, Buenos Aires time. ponytail: fixed UTC-3 offset (Argentina has no DST). */
function monthStartIso(now = Date.now()) {
  const [y, m] = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit" }).format(new Date(now)).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1, 3)).toISOString();
}

async function countRows(userId: string, filter: string) {
  const params = new URLSearchParams({ filter: `user = ${quote(userId)} && ${filter}`, fields: "id", perPage: "1" });
  return (await pocketBaseFetch<{ totalItems: number }>(`${RECORDS}?${params}`)).totalItems;
}

/**
 * WhatsApp quota is monthly (per plan): sent this month + waiting in the worker queue + scheduled and not sent yet.
 * Scheduling consumes it right away, so the counter and the limit already include what is programmed.
 */
export async function whatsAppMonthlyUsage(userId: string) {
  const [session, scheduled, limits] = await Promise.all([
    getWhatsAppSession(userId).catch(() => null),
    countRows(userId, `channel = "whatsapp" && (status = "scheduled" || status = "sending")`),
    getPlanLimits(userId),
  ]);
  const limit = limits.whatsappMonthly;
  const used = (session?.sentThisMonth ?? 0) + (session?.queued ?? 0) + scheduled;
  return { used: Math.min(limit, used), limit, remaining: Math.max(0, limit - used) };
}

/**
 * Schedules left this month for `channel`. Without a plan: 10 across every channel (cancelled ones free their slot).
 * With a plan: its WhatsApp schedule cap; emails stay unlimited. Owners are unlimited.
 */
export async function schedulesLeft(userId: string, channel: ScheduledChannel | "any" = "any") {
  const [user, limits] = await Promise.all([pocketBaseFetch<{ role?: string }>(`/api/collections/users/records/${encodeURIComponent(userId)}?fields=role`), getPlanLimits(userId)]);
  if (user.role === "owner") return Infinity;
  const since = `status != "cancelled" && created >= ${quote(pbDate(monthStartIso()))}`;
  if (!limits.hasPlan) return Math.max(0, limits.scheduledMonthly - await countRows(userId, since));
  if (channel !== "whatsapp") return Infinity;
  return Math.max(0, limits.scheduledMonthly - await countRows(userId, `channel = "whatsapp" && ${since}`));
}

/** Both caps for `count` new rows. ponytail: check-then-insert; two concurrent schedules can overshoot by one batch. */
async function assertCanSchedule(userId: string, channel: ScheduledChannel, count: number) {
  if (count > await schedulesLeft(userId, channel)) throw new ScheduleError("schedule_limit");
  if (channel === "whatsapp" && count > (await whatsAppMonthlyUsage(userId)).remaining) throw new ScheduleError("whatsapp_monthly_limit");
}

const cleanText = (value: unknown, max: number) => (typeof value === "string" && value.trim() && value.length <= max ? value.trim() : "");

/** Rows of a confirmed send card (after edits / batch review). */
function rowsOf(payload: PendingPayload): { channel: ScheduledChannel; leadId: string; leadName: string; recipient: string; subject: string; body: string }[] {
  if (payload.kind === "send_email") {
    const extra = payload.extra ?? {};
    return [{ channel: "email", leadId: payload.leadId, leadName: payload.leadName, recipient: String(extra.to ?? ""), subject: String(extra.subject ?? ""), body: String(extra.body ?? "") }];
  }
  if (payload.kind === "send_email_batch") return (payload.rows ?? []).map((row) => ({ channel: "email", leadId: row.leadId, leadName: row.leadName, recipient: row.to, subject: row.subject, body: row.body }));
  if (payload.kind === "send_whatsapp_batch") return (payload.rows ?? []).map((row) => ({ channel: "whatsapp", leadId: row.leadId, leadName: row.leadName, recipient: row.phone, subject: "", body: row.text }));
  return [];
}

async function findByCardRef(userId: string, cardRef: string) {
  const params = new URLSearchParams({ filter: `user = ${quote(userId)} && card_ref = ${quote(cardRef)}`, fields: "id", perPage: "1", skipTotal: "1" });
  return (await pocketBaseFetch<{ items: { id: string }[] }>(`${RECORDS}?${params}`)).items[0] ?? null;
}

/** Schedules a confirmed send card. Idempotent per card and lead (unique card_ref), so a replayed confirm schedules nothing new. */
export async function scheduleFromCard(userId: string, payload: PendingPayload, sendAt: string) {
  let scheduled = 0;
  let replayed = 0;
  const rows = rowsOf(payload);
  if (rows.length) await assertCanSchedule(userId, rows[0].channel, rows.length);
  for (const row of rows) {
    if (!ID.test(row.leadId) || !row.recipient || !row.body) continue;
    const cardRef = createHash("sha256").update(`${payload.iat}:${payload.kind}:${row.leadId}`).digest("hex").slice(0, 40);
    try {
      await pocketBaseFetch(RECORDS, {
        method: "POST",
        body: JSON.stringify({ user: userId, channel: row.channel, lead_id: row.leadId, lead_name: row.leadName.slice(0, 300), recipient: row.recipient, subject: row.subject, body: row.body, send_at: pbDate(sendAt), status: "scheduled", card_ref: cardRef }),
      });
      scheduled++;
    } catch (error) {
      if (await findByCardRef(userId, cardRef).catch(() => null)) replayed++;
      else throw error;
    }
  }
  return { scheduled, replayed };
}

/**
 * Manual "Nuevo programado" from the Programados modal. The recipient comes from the user's own lead (email, or its
 * WhatsApp number), never from the client, so a schedule can only target the user's leads.
 */
export async function createScheduled(userId: string, input: { channel?: unknown; leadId?: unknown; sendAt?: unknown; subject?: unknown; body?: unknown }): Promise<ScheduledMessage> {
  const channel = input.channel === "email" || input.channel === "whatsapp" ? input.channel : null;
  const leadId = typeof input.leadId === "string" && ID.test(input.leadId) ? input.leadId : "";
  if (!channel || !leadId) throw new ScheduleError("invalid");
  const sendAt = parseSendAt(input.sendAt);
  if (!sendAt) throw new ScheduleError("invalid_send_at");
  const body = cleanText(input.body, channel === "email" ? EMAIL_BODY_MAX : WHATSAPP_TEXT_MAX);
  const subject = channel === "email" ? cleanText(input.subject, SUBJECT_MAX) : "";
  if (!body || (channel === "email" && !subject)) throw new ScheduleError("invalid");
  const lead = await getUserLead(userId, leadId);
  if (!lead) throw new ScheduleError("not_found");
  const recipient = channel === "email" ? (await getLeadPainBrief(userId, leadId))?.email ?? "" : await getLeadWhatsApp(userId, leadId);
  if (!recipient || (channel === "email" && !isValidEmail(recipient))) throw new ScheduleError("recipient_missing");
  if (!(channel === "email" ? await hasGmail(userId) : await isWhatsAppConnected(userId))) throw new ScheduleError(channel === "email" ? "needs_gmail" : "needs_whatsapp");
  await assertCanSchedule(userId, channel, 1);
  const row = await pocketBaseFetch<Row>(RECORDS, {
    method: "POST",
    body: JSON.stringify({ user: userId, channel, lead_id: lead.id, lead_name: lead.name.slice(0, 300), recipient, subject, body, send_at: pbDate(sendAt), status: "scheduled", card_ref: `manual:${randomUUID()}` }),
  });
  return toMessage(row);
}

/** Pending, failed and recent (14 days) scheduled messages of the user, soonest first. */
export async function listScheduled(userId: string): Promise<ScheduledMessage[]> {
  const since = pbDate(new Date(Date.now() - 14 * 24 * 60 * 60_000).toISOString());
  const params = new URLSearchParams({
    filter: `user = ${quote(userId)} && (status = "scheduled" || status = "sending" || status = "queued" || status = "delivered" || status = "failed" || send_at >= ${quote(since)})`,
    sort: "send_at",
    perPage: "200",
    skipTotal: "1",
  });
  return (await pocketBaseFetch<{ items: Row[] }>(`${RECORDS}?${params}`)).items.map(toMessage);
}

async function getOwnRow(userId: string, id: string) {
  if (!ID.test(id)) throw new ScheduleError("not_found");
  const row = await pocketBaseFetch<Row>(`${RECORDS}/${encodeURIComponent(id)}`).catch(() => null);
  if (!row || row.user !== userId) throw new ScheduleError("not_found");
  return row;
}

/** Cancel, or reschedule / edit (also retries a failed one). Only rows not sent yet. */
export async function updateScheduled(userId: string, id: string, input: { action?: unknown; sendAt?: unknown; subject?: unknown; body?: unknown }): Promise<ScheduledMessage> {
  const row = await getOwnRow(userId, id);
  if (row.status !== "scheduled" && row.status !== "failed") throw new ScheduleError("not_editable");
  if (input.action === "cancel") {
    return toMessage(await pocketBaseFetch<Row>(`${RECORDS}/${row.id}`, { method: "PATCH", body: JSON.stringify({ status: "cancelled" }) }));
  }
  const sendAt = parseSendAt(input.sendAt);
  if (!sendAt) throw new ScheduleError("invalid_send_at");
  const body = cleanText(input.body, row.channel === "email" ? EMAIL_BODY_MAX : WHATSAPP_TEXT_MAX);
  const subject = row.channel === "email" ? cleanText(input.subject, SUBJECT_MAX) : "";
  if (!body || (row.channel === "email" && !subject)) throw new ScheduleError("invalid");
  return toMessage(await pocketBaseFetch<Row>(`${RECORDS}/${row.id}`, {
    method: "PATCH",
    body: JSON.stringify({ send_at: pbDate(sendAt), subject, body, status: "scheduled", error: "" }),
  }));
}

const patchRow = (id: string, data: Record<string, unknown>) => pocketBaseFetch(`${RECORDS}/${id}`, { method: "PATCH", body: JSON.stringify(data) });

/** Encode the PocketBase row id into the worker's 40-hex ref so callbacks can settle the right schedule without a schema field. */
function scheduledWhatsAppRef(rowId: string) {
  if (!ID.test(rowId)) throw new ScheduleError("not_found");
  return `${Buffer.from(rowId, "utf8").toString("hex")}${createHash("sha256").update(`scheduled:${rowId}`).digest("hex").slice(0, 10)}`;
}

function scheduledIdFromWhatsAppRef(ref: string) {
  if (!/^[a-f0-9]{40}$/.test(ref)) return null;
  const rowId = Buffer.from(ref.slice(0, 30), "hex").toString("utf8");
  return ID.test(rowId) && scheduledWhatsAppRef(rowId) === ref ? rowId : null;
}

/** Worker callbacks are the only source of truth for when a queued WhatsApp message was actually sent. */
export async function settleScheduledWhatsApp(userId: string, ref: string, outcome: "sent" | "failed", at: string) {
  const id = scheduledIdFromWhatsAppRef(ref);
  if (!id) return false;
  const row = await pocketBaseFetch<Row>(`${RECORDS}/${encodeURIComponent(id)}`).catch(() => null);
  if (!row || row.user !== userId || row.channel !== "whatsapp" || row.status !== "queued") return false;
  await patchRow(id, outcome === "sent"
    ? { status: "delivered", sent_at: pbDate(at), error: "" }
    : { status: "failed", error: "send_failed" });
  return true;
}

async function sendRow(row: Row): Promise<"sent" | "queued" | "failed" | "retry"> {
  if (row.channel === "email") {
    const quota = await reserveGmailDailyUsage(row.user, 1);
    if (!quota.granted) { await patchRow(row.id, { status: "failed", error: "gmail_daily_limit" }); return "failed"; }
    try {
      await sendGmail(row.user, { to: row.recipient, subject: row.subject ?? "", text: row.body });
    } catch (error) {
      await quota.settle(0).catch(() => undefined);
      await patchRow(row.id, { status: "failed", error: error instanceof GmailNotConnectedError ? "needs_gmail" : "send_failed" });
      return "failed";
    }
    await patchRow(row.id, { status: "sent", sent_at: pbDate(new Date().toISOString()), error: "" });
    await recordLeadContact(row.user, { leadId: row.lead_id, channel: "email", message: emailLog(row.subject ?? "", row.body), contactedAt: new Date().toISOString() }).catch(() => undefined);
    return "sent";
  }
  // WhatsApp: handed to the worker queue (spaced, daily cap); the worker's "sent" callback logs the contact.
  try {
    const ref = scheduledWhatsAppRef(row.id);
    const result = await enqueueWhatsApp(row.user, [{ ref, leadId: row.lead_id, phone: row.recipient, text: row.body }]);
    if (result.invalid.length) { await patchRow(row.id, { status: "failed", error: "invalid_number" }); return "failed"; }
    if (result.queued.includes(ref)) {
      await patchRow(row.id, { status: "queued", error: "" });
      return "queued";
    }
    if (result.duplicates.includes(ref)) {
      const state = await getWhatsAppMessageStatus(row.user, ref);
      if (state.status === "sent") {
        await patchRow(row.id, { status: "delivered", sent_at: pbDate(new Date().toISOString()), error: "" });
        return "sent";
      }
      if (state.status === "queued") {
        await patchRow(row.id, { status: "queued", error: "" });
        return "queued";
      }
      if (state.status === "failed") {
        await patchRow(row.id, { status: "failed", error: "send_failed" });
        return "failed";
      }
      throw new Error("whatsapp_status_unknown");
    }
    throw new Error("whatsapp_not_accepted");
  } catch (error) {
    if (error instanceof WhatsAppNotConnectedError) { await patchRow(row.id, { status: "failed", error: "needs_whatsapp" }); return "failed"; }
    // Worker hiccup: back to the queue for the next tick.
    await patchRow(row.id, { status: "scheduled" });
    return "retry";
  }
}

/**
 * Sends the due rows. Runs one at a time: the worker awaits each call before scheduling the next minute
 * (ponytail: no row lock; a second concurrent dispatcher could double-send — add a claim field if that ever runs).
 * At most one email per user per tick, so a scheduled batch goes out about a minute apart.
 */
export async function dispatchDue(deadline: number, now = Date.now()) {
  const stale = new URLSearchParams({ filter: `status = "sending" && updated < ${quote(pbDate(new Date(now - STALE_SENDING_MS).toISOString()))}`, fields: "id", perPage: "50", skipTotal: "1" });
  for (const row of (await pocketBaseFetch<{ items: { id: string }[] }>(`${RECORDS}?${stale}`)).items) await patchRow(row.id, { status: "failed", error: "interrupted" }).catch(() => undefined);

  const params = new URLSearchParams({ filter: `status = "scheduled" && send_at <= ${quote(pbDate(new Date(now).toISOString()))}`, sort: "send_at", perPage: String(DUE_BATCH), skipTotal: "1" });
  const due = (await pocketBaseFetch<{ items: Row[] }>(`${RECORDS}?${params}`)).items;
  const emailedThisTick = new Set<string>();
  const counts = { sent: 0, queued: 0, failed: 0, retry: 0, deferred: 0 };
  for (const row of due) {
    if (Date.now() > deadline) break;
    if (row.channel === "email" && emailedThisTick.has(row.user)) { counts.deferred++; continue; }
    if (row.channel === "email") emailedThisTick.add(row.user);
    await patchRow(row.id, { status: "sending" });
    try {
      counts[await sendRow(row)]++;
    } catch (error) {
      console.error("Scheduled send failed", error instanceof Error ? error.name : "unknown");
      await patchRow(row.id, { status: "failed", error: "send_failed" }).catch(() => undefined);
      counts.failed++;
    }
  }
  return counts;
}
