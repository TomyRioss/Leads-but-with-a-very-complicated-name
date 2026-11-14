// Gmail send-only (gmail.send scope): builds an RFC 2822 message and sends it as the connected user.
// Never logs tokens, recipients or message content.
import { GOOGLE_SCOPES, GoogleNotConnectedError, getConnection, getValidAccessToken, scopesInclude } from "@/lib/server/google-connections";

export const GMAIL_LIMITS = { subject: 200, body: 20_000, footer: 1_000, timeoutMs: 20_000, batchMax: 50, batchDelayMs: 20_000 } as const;

export type GmailMessageInput = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  /** Optional unsubscribe footer appended to text and HTML bodies. */
  footer?: string;
  /** Optional List-Unsubscribe target (mailto: or https: URL). */
  listUnsubscribe?: string;
};
export type GmailSendResult = { id: string; threadId: string };

export class GmailNotConnectedError extends Error {
  constructor() {
    super("Gmail is not connected.");
    this.name = "GmailNotConnectedError";
  }
}

export class GmailQuotaError extends Error {
  constructor() {
    super("Gmail sending quota reached.");
    this.name = "GmailQuotaError";
  }
}

export type GmailValidationField = "to" | "subject" | "text" | "html" | "replyTo" | "footer" | "listUnsubscribe";
export class GmailValidationError extends Error {
  readonly field: GmailValidationField;
  constructor(field: GmailValidationField) {
    super(`Invalid email field: ${field}.`);
    this.name = "GmailValidationError";
    this.field = field;
  }
}

export class GmailSendError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`Gmail responded ${status}.`);
    this.name = "GmailSendError";
    this.status = status;
  }
}

// ---------- Pure helpers ----------

const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

export function isValidEmail(value: string): boolean {
  return value.length <= 254 && EMAIL.test(value) && !value.includes("..");
}

export function base64url(value: string | Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

/** RFC 2047 encoded-words for non-ASCII headers; each word ≤ 75 chars and never splits a character (emoji included). */
export function encodeHeaderValue(value: string): string {
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  const words: string[] = [];
  let chunk = "";
  for (const char of value) {
    // 45 bytes → 60 base64 chars + 12 for "=?UTF-8?B??=" = 72.
    if (Buffer.byteLength(chunk + char) > 45) {
      words.push(chunk);
      chunk = "";
    }
    chunk += char;
  }
  if (chunk) words.push(chunk);
  return words.map((word) => `=?UTF-8?B?${Buffer.from(word).toString("base64")}?=`).join("\r\n ");
}

const wrap76 = (base64: string) => base64.replace(/.{1,76}/g, "$&\r\n").trimEnd();
const bodyPart = (type: string, content: string) =>
  [`Content-Type: ${type}; charset="UTF-8"`, "Content-Transfer-Encoding: base64", "", wrap76(Buffer.from(content).toString("base64"))].join("\r\n");
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
const noBreaks = (value: string) => !/[\r\n]/.test(value);

/** Validates and normalizes the message; throws GmailValidationError on the first bad field. */
export function validateGmailInput(input: GmailMessageInput): GmailMessageInput {
  const to = (input.to ?? "").trim();
  const subject = (input.subject ?? "").replace(/\s+/g, " ").trim();
  const text = (input.text ?? "").replace(/\r\n?/g, "\n").trim();
  const replyTo = input.replyTo?.trim();
  const footer = input.footer?.trim();
  const listUnsubscribe = input.listUnsubscribe?.trim();
  if (!isValidEmail(to)) throw new GmailValidationError("to");
  if (!subject || subject.length > GMAIL_LIMITS.subject) throw new GmailValidationError("subject");
  if (!text || text.length > GMAIL_LIMITS.body) throw new GmailValidationError("text");
  if (input.html !== undefined && (typeof input.html !== "string" || input.html.length > GMAIL_LIMITS.body)) throw new GmailValidationError("html");
  if (replyTo && !isValidEmail(replyTo)) throw new GmailValidationError("replyTo");
  if (footer && footer.length > GMAIL_LIMITS.footer) throw new GmailValidationError("footer");
  if (listUnsubscribe && (!/^(mailto:|https:\/\/)\S+$/i.test(listUnsubscribe) || listUnsubscribe.length > 500)) throw new GmailValidationError("listUnsubscribe");
  return { to, subject, text, html: input.html?.trim() || undefined, replyTo: replyTo || undefined, footer: footer || undefined, listUnsubscribe: listUnsubscribe || undefined };
}

/** RFC 2822 message (CRLF): UTF-8 encoded headers, base64 bodies, multipart/alternative when HTML is given. */
export function buildMimeMessage(input: GmailMessageInput, boundary = `leadta_${crypto.randomUUID()}`): string {
  const message = validateGmailInput(input);
  const text = message.footer ? `${message.text}\n\n--\n${message.footer}` : message.text;
  const html = message.html && (message.footer ? `${message.html}<hr><p style="font-size:12px;color:#676e67">${escapeHtml(message.footer).replace(/\n/g, "<br>")}</p>` : message.html);
  const headers = [
    `To: ${message.to}`,
    `Subject: ${encodeHeaderValue(message.subject)}`,
    "MIME-Version: 1.0",
  ];
  if (message.replyTo && noBreaks(message.replyTo)) headers.push(`Reply-To: ${message.replyTo}`);
  if (message.listUnsubscribe && noBreaks(message.listUnsubscribe)) headers.push(`List-Unsubscribe: <${message.listUnsubscribe}>`);
  if (!html) return [...headers, bodyPart("text/plain", text)].join("\r\n");
  return [
    ...headers,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    bodyPart("text/plain", text),
    `--${boundary}`,
    bodyPart("text/html", html),
    `--${boundary}--`,
  ].join("\r\n");
}

type GoogleErrorBody = { error?: { status?: string; errors?: { reason?: string }[] } };
const QUOTA_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded", "dailyLimitExceeded", "quotaExceeded"]);

/** Maps a failed Gmail response to a typed error (status + Google's reason only; the body is never logged). */
export function gmailErrorFrom(status: number, body: unknown): Error {
  const error = (body as GoogleErrorBody | null)?.error;
  const reasons = (error?.errors ?? []).map((item) => item.reason ?? "");
  if (status === 429 || error?.status === "RESOURCE_EXHAUSTED" || reasons.some((reason) => QUOTA_REASONS.has(reason))) return new GmailQuotaError();
  if (status === 401 || (status === 403 && (error?.status === "PERMISSION_DENIED" || reasons.includes("insufficientPermissions")))) return new GmailNotConnectedError();
  return new GmailSendError(status);
}

// ---------- Sending ----------

export async function sendGmail(userId: string, input: GmailMessageInput): Promise<GmailSendResult> {
  const raw = base64url(buildMimeMessage(input));
  const connection = await getConnection(userId);
  if (!connection || !scopesInclude(connection.scopes, GOOGLE_SCOPES.gmailSend)) throw new GmailNotConnectedError();
  let token: string;
  try {
    token = await getValidAccessToken(userId);
  } catch (error) {
    if (error instanceof GoogleNotConnectedError) throw new GmailNotConnectedError();
    throw error;
  }
  let response: Response;
  try {
    response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
      cache: "no-store",
      signal: AbortSignal.timeout(GMAIL_LIMITS.timeoutMs),
    });
  } catch {
    throw new GmailSendError(0);
  }
  if (!response.ok) throw gmailErrorFrom(response.status, await response.json().catch(() => null));
  const payload = (await response.json()) as { id?: string; threadId?: string };
  return { id: payload.id ?? "", threadId: payload.threadId ?? "" };
}

export type GmailBatchItemResult = { index: number; ok: true; id: string; threadId: string } | { index: number; ok: false; error: string; field?: GmailValidationField };
export type GmailBatchResult = { results: GmailBatchItemResult[]; sent: number; failed: number; skipped: number; stoppedBy: "quota" | "not_connected" | "aborted" | null };
export type GmailBatchOptions = {
  delayMs?: number;
  max?: number;
  signal?: AbortSignal;
  /** Test seams: defaults send through Gmail and wait with a timer. */
  send?: (userId: string, input: GmailMessageInput) => Promise<GmailSendResult>;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

const defaultSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  });

/**
 * Sends in order, one at a time, waiting `delayMs` between sends. Stops on quota / lost permission / abort;
 * the rest count as skipped. Items past `max` are skipped. Invalid items fail individually and don't stop the batch.
 */
export async function sendGmailBatch(userId: string, items: GmailMessageInput[], opts: GmailBatchOptions = {}): Promise<GmailBatchResult> {
  const delayMs = Math.max(0, opts.delayMs ?? GMAIL_LIMITS.batchDelayMs);
  const max = Math.min(GMAIL_LIMITS.batchMax, Math.max(0, opts.max ?? GMAIL_LIMITS.batchMax));
  const send = opts.send ?? sendGmail;
  const sleep = opts.sleep ?? defaultSleep;
  const results: GmailBatchItemResult[] = [];
  let stoppedBy: GmailBatchResult["stoppedBy"] = null;
  let attempted = 0;

  for (let index = 0; index < Math.min(items.length, max); index++) {
    if (opts.signal?.aborted) { stoppedBy = "aborted"; break; }
    // Validate before waiting: an invalid item never costs a delay.
    let input: GmailMessageInput;
    try {
      input = validateGmailInput(items[index]);
    } catch (error) {
      results.push({ index, ok: false, error: "invalid", field: error instanceof GmailValidationError ? error.field : undefined });
      continue;
    }
    if (attempted > 0 && delayMs > 0) {
      await sleep(delayMs, opts.signal);
      if (opts.signal?.aborted) { stoppedBy = "aborted"; break; }
    }
    attempted++;
    try {
      const sent = await send(userId, input);
      results.push({ index, ok: true, ...sent });
    } catch (error) {
      if (error instanceof GmailQuotaError) { results.push({ index, ok: false, error: "quota" }); stoppedBy = "quota"; break; }
      if (error instanceof GmailNotConnectedError) { results.push({ index, ok: false, error: "not_connected" }); stoppedBy = "not_connected"; break; }
      results.push({ index, ok: false, error: error instanceof GmailValidationError ? "invalid" : "failed" });
    }
  }
  const sent = results.filter((result) => result.ok).length;
  return { results, sent, failed: results.length - sent, skipped: items.length - results.length, stoppedBy };
}
