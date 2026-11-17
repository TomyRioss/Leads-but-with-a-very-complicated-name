import { applyPendingChange, StaleChangeError, verifyPendingChange } from "@/lib/server/lead-suite-agent";
import { withBatchReview, withGoogleEdits, withKeywordSubset } from "@/lib/server/leadtita-tools";
import { GmailNotConnectedError, GmailQuotaError, GmailValidationError } from "@/lib/server/google-gmail";
import { CalendarNotConnectedError, CalendarValidationError } from "@/lib/server/google-calendar";
import { isWhatsAppConnected, WhatsAppNotConnectedError, WhatsAppUnavailableError } from "@/lib/server/whatsapp";
import { CreditOperationBusyError, InsufficientCreditsError } from "@/lib/server/credits";
import { parseSendAt, SCHEDULABLE_KINDS, ScheduleError, scheduleFromCard, whatsAppMonthlyUsage } from "@/lib/server/scheduled-messages";
import { hasGmail } from "@/lib/server/google-connections";
import { getTranslator } from "@/lib/server/locale";
import { uiError } from "@/lib/server/public-error";

const SKIP_NEEDS_CONFIRMATION = new Set<string>(["send_email", "send_email_batch", "send_whatsapp_batch"]);
const SKIP_CREDIT_SHARE = 0.3;
// Batch sends always need the user's review, whatever the permission (also "Peligro").
const ALWAYS_REVIEW = new Set<string>(["send_email_batch", "send_whatsapp_batch"]);

export type ConfirmInput = { token: unknown; keywords?: unknown; edits?: unknown; review?: unknown; sendAt?: unknown; auto?: unknown };
/** `error` set = final message; otherwise the caller shows its generic text (invalidRequestBody for 400s without a code other than "invalid"). */
export type ConfirmOutcome =
  | { ok: true; result: unknown }
  | { ok: false; status: number; code?: string; error?: string; extra?: Record<string, number> };

const fail = (status: number, code?: string, extra?: Record<string, number>): ConfirmOutcome => ({ ok: false, status, ...(code ? { code } : {}), ...(extra ? { extra } : {}) });

/**
 * Executes a change the user confirmed. The signed token is the only input; it is re-verified and re-validated here.
 * Stateless token, but single effect: applyPendingChange dedupes creations/searches and checks the signed record hash on edits.
 */
export async function confirmPendingChange(user: { id: string; credits: number }, input: ConfirmInput, opts: { locale: "es" | "en" }): Promise<ConfirmOutcome> {
  const verified = verifyPendingChange(input.token, user.id);
  // Optional edited keyword list: must be a non-empty subset of the signed keywords.
  // Optional card edits (email draft, meeting time): re-validated; only for email/meeting cards.
  const withKeywords = verified ? withKeywordSubset(verified, input.keywords) : null;
  // Optional batch review (recipients kept + edited messages): a subset of the signed rows only.
  const withEdits = withKeywords ? withGoogleEdits(withKeywords, input.edits) : null;
  const payload = withEdits ? withBatchReview(withEdits, input.review) : null;
  if (!payload) return fail(400);
  if (input.auto !== undefined && ALWAYS_REVIEW.has(payload.kind)) return fail(409, "needs_confirmation");
  // "Omitir" permission: sends and actions above 30% of the current balance fall back to the Yes/No card.
  if (input.auto === "skip" && (SKIP_NEEDS_CONFIRMATION.has(payload.kind) || Number(payload.extra?.credits ?? 0) > user.credits * SKIP_CREDIT_SHARE)) {
    return fail(409, "needs_confirmation");
  }

  // "Programar": the confirmed card is stored in "Programados" and sent at sendAt by the dispatcher instead of now.
  if (input.sendAt !== undefined) {
    const when = parseSendAt(input.sendAt);
    if (!SCHEDULABLE_KINDS.has(payload.kind) || !when) return fail(400, "invalid_send_at");
    try {
      const whatsapp = payload.kind === "send_whatsapp_batch";
      if (!(whatsapp ? await isWhatsAppConnected(user.id) : await hasGmail(user.id))) return fail(409, whatsapp ? "needs_whatsapp" : "needs_gmail");
      const { scheduled, replayed } = await scheduleFromCard(user.id, payload, when);
      return { ok: true, result: { kind: payload.kind, leadName: payload.leadName, summary: { scheduled, sendAt: when, ...(replayed && !scheduled ? { replayed: true } : {}) } } };
    } catch (error) {
      if (error instanceof ScheduleError && (error.code === "schedule_limit" || error.code === "whatsapp_monthly_limit")) return fail(429, error.code);
      console.error("Lead Suite schedule failed", error instanceof Error ? error.name : "unknown");
      return fail(503);
    }
  }

  // WhatsApp quota is monthly and already counts queued + scheduled messages: refuse a batch that doesn't fit.
  if (payload.kind === "send_whatsapp_batch") {
    const quota = await whatsAppMonthlyUsage(user.id).catch(() => null);
    if (quota && (payload.rows?.length ?? 0) > quota.remaining) return fail(429, "whatsapp_monthly_limit", { remaining: quota.remaining });
  }

  try {
    return { ok: true, result: await applyPendingChange(user.id, payload, { locale: opts.locale }) };
  } catch (error) {
    if (error instanceof StaleChangeError) return { ok: false, status: 409, code: "stale", error: error.message };
    if (error instanceof GmailNotConnectedError) return fail(409, "needs_gmail");
    if (error instanceof CalendarNotConnectedError) return fail(409, "needs_calendar");
    if (error instanceof WhatsAppNotConnectedError) return fail(409, "needs_whatsapp");
    if (error instanceof WhatsAppUnavailableError) {
      console.error("Lead Suite confirm: WhatsApp worker", error.message);
      return fail(503, "whatsapp_unavailable");
    }
    if (error instanceof InsufficientCreditsError) return fail(402, "no_credits", { available: error.available, required: error.required });
    if (error instanceof CreditOperationBusyError) return fail(409, "credit_busy");
    if (error instanceof GmailQuotaError) return fail(429, "gmail_quota");
    if (error instanceof GmailValidationError || error instanceof CalendarValidationError) return fail(400, "invalid");
    console.error("Lead Suite confirm failed", error);
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, status: 502, error: uiError(detail, getTranslator(opts.locale, "Errors")("generic")) };
  }
}
