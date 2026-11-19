import { timingSafeEqual } from "node:crypto";
import { parsePhoneNumberFromString } from "libphonenumber-js/min";
import { getUserLead } from "@/lib/server/lead-suite";
import { pocketBaseFetch } from "@/lib/server/pocketbase";

// Client for the WhatsApp worker (services/whatsapp-worker, Baileys). One linked WhatsApp per user; the worker owns
// sessions and the send queue, this app only talks to it with a shared secret and records what it reports back.

export type WhatsAppStatus = "disconnected" | "connecting" | "qr" | "connected";
/** sentThisMonth / monthlyLimit: the worker's safety cap, month in Buenos Aires time. Per-plan caps live in the app (whatsAppMonthlyUsage). */
export type WhatsAppSession = { status: WhatsAppStatus; qr: string | null; phone: string | null; sentThisMonth: number; monthlyLimit: number; queued: number };
export type WhatsAppOutgoing = { ref: string; leadId: string; phone: string; text: string };
export type WhatsAppEnqueueResult = { queued: string[]; duplicates: string[]; invalid: { ref: string; reason: string }[]; etaSeconds: number };
export type WhatsAppMessageStatus = { status: "queued" | "sent" | "failed" | "unknown"; connection: WhatsAppStatus };

export const WHATSAPP_BATCH_MAX = 10;
export const WHATSAPP_TEXT_MAX = 1500;
const TIMEOUT_MS = 10_000;
// onWhatsApp checks run per number before queueing.
const ENQUEUE_TIMEOUT_MS = 30_000;
const USER_ID = /^[a-zA-Z0-9]{15}$/;

export class WhatsAppNotConnectedError extends Error {
  constructor() { super("WhatsApp is not connected."); this.name = "WhatsAppNotConnectedError"; }
}
export class WhatsAppUnavailableError extends Error {
  constructor(detail: string) { super(`WhatsApp worker unavailable: ${detail}`); this.name = "WhatsAppUnavailableError"; }
}

function config() {
  const url = process.env.WHATSAPP_WORKER_URL?.trim();
  const secret = process.env.WHATSAPP_WORKER_SECRET?.trim();
  return url && secret && secret.length >= 32 ? { url: url.replace(/\/+$/, ""), secret } : null;
}

export const isWhatsAppConfigured = () => config() !== null;

/** Worker → app callbacks carry the same shared secret. */
export function isWorkerRequest(request: Request) {
  const secret = config()?.secret;
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function worker<T>(path: string, init: RequestInit = {}, timeoutMs = TIMEOUT_MS): Promise<T> {
  const cfg = config();
  if (!cfg) throw new WhatsAppUnavailableError("not_configured");
  let response: Response;
  try {
    response = await fetch(`${cfg.url}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${cfg.secret}`, "Content-Type": "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new WhatsAppUnavailableError(error instanceof Error ? error.name : "fetch_failed");
  }
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (response.status === 409 && body.error === "not_connected") throw new WhatsAppNotConnectedError();
  if (!response.ok) throw new WhatsAppUnavailableError(`status_${response.status}`);
  return body as T;
}

const sessionPath = (userId: string) => {
  if (!USER_ID.test(userId)) throw new Error("Invalid user id.");
  return `/sessions/${userId}`;
};

export const getWhatsAppSession = (userId: string) => worker<WhatsAppSession>(sessionPath(userId));
export const getWhatsAppMessageStatus = (userId: string, ref: string) =>
  worker<WhatsAppMessageStatus>(`${sessionPath(userId)}/messages/${encodeURIComponent(ref)}`);
export const getWhatsAppMessageStatuses = (userId: string, refs: string[]) => {
  if (!refs.length || refs.length > 25 || refs.some((ref) => !/^[a-f0-9]{40}$/.test(ref))) throw new Error("Invalid WhatsApp message refs.");
  const query = new URLSearchParams(refs.map((ref) => ["ref", ref]));
  return worker<{ statuses: Record<string, WhatsAppMessageStatus["status"]>; connection: WhatsAppStatus }>(`${sessionPath(userId)}/messages?${query}`);
};
export const startWhatsAppSession = (userId: string) => worker<WhatsAppSession>(`${sessionPath(userId)}/start`, { method: "POST" });
export const stopWhatsAppSession = (userId: string) => worker<{ status: WhatsAppStatus }>(sessionPath(userId), { method: "DELETE" });

export async function isWhatsAppConnected(userId: string) {
  if (!isWhatsAppConfigured()) return false;
  try {
    return (await getWhatsAppSession(userId)).status === "connected";
  } catch {
    return false;
  }
}

export function enqueueWhatsApp(userId: string, items: WhatsAppOutgoing[]) {
  return worker<WhatsAppEnqueueResult>(`${sessionPath(userId)}/messages`, { method: "POST", body: JSON.stringify({ items: items.slice(0, WHATSAPP_BATCH_MAX) }) }, ENQUEUE_TIMEOUT_MS);
}

/** International number as digits (E.164 without +), or "" when it isn't a valid international number. */
export function whatsAppDigits(raw: string) {
  const value = raw.trim();
  const fromLink = value.match(/(?:wa\.me\/|phone=)\+?(\d{8,15})/i)?.[1];
  const candidate = fromLink ? `+${fromLink}` : value.startsWith("00") ? `+${value.slice(2)}` : value;
  if (!candidate.startsWith("+")) return "";
  const parsed = parsePhoneNumberFromString(candidate);
  return parsed?.isValid() ? parsed.number.slice(1) : "";
}

/** The lead's WhatsApp (explicit field first, then its phone) as digits; "" if none is usable. Ownership checked. */
export async function getLeadWhatsApp(userId: string, leadId: string) {
  const lead = await getUserLead(userId, leadId);
  if (!lead) return "";
  const row = await pocketBaseFetch<{ whatsapp?: string }>(`/api/collections/leads/records/${encodeURIComponent(lead.id)}?fields=whatsapp`).catch(() => ({ whatsapp: "" }));
  return whatsAppDigits(row.whatsapp ?? "") || whatsAppDigits(lead.phone);
}
