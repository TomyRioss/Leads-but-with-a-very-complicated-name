import { NextResponse } from "next/server";
import { getCurrentUser, withRefreshedSession } from "@/lib/server/auth";
import { isPocketBaseConfigured } from "@/lib/server/pocketbase";
import { isClientId, isConversationInactive } from "@/lib/server/leadtita-conversations";
import { uiError } from "@/lib/server/public-error";
import { errorTranslator, resolveLocale } from "@/lib/server/locale";
import { applyPendingChange, StaleChangeError, verifyPendingChange } from "@/lib/server/lead-suite-agent";
import { withBatchReview, withGoogleEdits, withKeywordSubset } from "@/lib/server/leadtita-tools";
import { GmailNotConnectedError, GmailQuotaError, GmailValidationError } from "@/lib/server/google-gmail";
import { CalendarNotConnectedError, CalendarValidationError } from "@/lib/server/google-calendar";
import { isWhatsAppConnected, WhatsAppNotConnectedError, WhatsAppUnavailableError } from "@/lib/server/whatsapp";
import { CreditOperationBusyError, InsufficientCreditsError } from "@/lib/server/credits";
import { parseSendAt, SCHEDULABLE_KINDS, ScheduleError, scheduleFromCard, whatsAppMonthlyUsage } from "@/lib/server/scheduled-messages";
import { hasGmail } from "@/lib/server/google-connections";

// Confirmed lead searches run here (through /api/search and /api/people/search), so allow their full duration.
export const maxDuration = 300;
// Import cards carry their signed rows (up to 2,000).
const MAX_BODY_BYTES = 3_000_000;
const SKIP_NEEDS_CONFIRMATION = new Set<string>(["send_email", "send_email_batch", "send_whatsapp_batch"]);
const SKIP_CREDIT_SHARE = 0.3;
// Batch sends always need the user's review, whatever the permission (also "Peligro").
const ALWAYS_REVIEW = new Set<string>(["send_email_batch", "send_whatsapp_batch"]);

/** Executes a change the user confirmed with "Yes". The signed token is the only input; it is re-verified and re-validated here. */
export async function POST(request: Request) {
  const t = errorTranslator(request);
  let session: Awaited<ReturnType<typeof getCurrentUser>>;
  try {
    session = await getCurrentUser(request);
  } catch {
    return NextResponse.json({ error: t("accountService") }, { status: 503 });
  }
  if (!session) return NextResponse.json({ error: t("signInToContinue") }, { status: 401 });
  if (!isPocketBaseConfigured()) return NextResponse.json({ error: uiError(t("pocketbaseNotConfigured"), t("generic")) }, { status: 503 });

  let token: unknown;
  let conversationId: unknown;
  let keywords: unknown;
  let edits: unknown;
  let auto: unknown;
  let review: unknown;
  let sendAt: unknown;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: t("invalidRequestBody") }, { status: 413 });
    const body = JSON.parse(raw) as { token?: unknown; conversationId?: unknown; keywords?: unknown; edits?: unknown; auto?: unknown; review?: unknown; sendAt?: unknown };
    token = body?.token;
    conversationId = body?.conversationId;
    keywords = body?.keywords;
    edits = body?.edits;
    auto = body?.auto;
    review = body?.review;
    sendAt = body?.sendAt;
  } catch {
    return NextResponse.json({ error: t("invalidRequestBody") }, { status: 400 });
  }
  if (!isClientId(conversationId)) return NextResponse.json({ error: t("invalidRequestBody") }, { status: 400 });
  try {
    if (await isConversationInactive(session.user.id, conversationId)) return NextResponse.json({ error: t("generic"), code: "conversation_inactive" }, { status: 410 });
  } catch {
    return NextResponse.json({ error: t("accountService") }, { status: 503 });
  }
  // Stateless token, but single effect: applyPendingChange dedupes creations/searches and checks the signed record hash on edits.
  const verified = verifyPendingChange(token, session.user.id);
  // Optional edited keyword list: must be a non-empty subset of the signed keywords.
  // Optional card edits (email draft, meeting time): re-validated; only for email/meeting cards.
  const withKeywords = verified ? withKeywordSubset(verified, keywords) : null;
  // Optional batch review (recipients kept + edited messages): a subset of the signed rows only.
  const withEdits = withKeywords ? withGoogleEdits(withKeywords, edits) : null;
  const payload = withEdits ? withBatchReview(withEdits, review) : null;
  if (!payload) return NextResponse.json({ error: t("invalidRequestBody") }, { status: 400 });
  if (auto !== undefined && ALWAYS_REVIEW.has(payload.kind)) {
    return withRefreshedSession(NextResponse.json({ error: t("generic"), code: "needs_confirmation" }, { status: 409 }), session.token);
  }
  // "Omitir" permission: sends and actions above 30% of the current balance fall back to the Yes/No card.
  if (auto === "skip" && (SKIP_NEEDS_CONFIRMATION.has(payload.kind) || Number(payload.extra?.credits ?? 0) > session.user.credits * SKIP_CREDIT_SHARE)) {
    return withRefreshedSession(NextResponse.json({ error: t("generic"), code: "needs_confirmation" }, { status: 409 }), session.token);
  }

  // "Programar": the confirmed card is stored in "Programados" and sent at sendAt by the dispatcher instead of now.
  if (sendAt !== undefined) {
    const when = parseSendAt(sendAt);
    if (!SCHEDULABLE_KINDS.has(payload.kind) || !when) return NextResponse.json({ error: t("invalidRequestBody"), code: "invalid_send_at" }, { status: 400 });
    try {
      const whatsapp = payload.kind === "send_whatsapp_batch";
      if (!(whatsapp ? await isWhatsAppConnected(session.user.id) : await hasGmail(session.user.id))) {
        return withRefreshedSession(NextResponse.json({ error: t("generic"), code: whatsapp ? "needs_whatsapp" : "needs_gmail" }, { status: 409 }), session.token);
      }
      const { scheduled, replayed } = await scheduleFromCard(session.user.id, payload, when);
      return withRefreshedSession(NextResponse.json({ result: { kind: payload.kind, leadName: payload.leadName, summary: { scheduled, sendAt: when, ...(replayed && !scheduled ? { replayed: true } : {}) } } }), session.token);
    } catch (error) {
      if (error instanceof ScheduleError && (error.code === "schedule_limit" || error.code === "whatsapp_monthly_limit")) {
        return withRefreshedSession(NextResponse.json({ error: t("generic"), code: error.code }, { status: 429 }), session.token);
      }
      console.error("Lead Suite schedule failed", error instanceof Error ? error.name : "unknown");
      return withRefreshedSession(NextResponse.json({ error: t("generic") }, { status: 503 }), session.token);
    }
  }

  // WhatsApp quota is monthly and already counts queued + scheduled messages: refuse a batch that doesn't fit.
  if (payload.kind === "send_whatsapp_batch") {
    const quota = await whatsAppMonthlyUsage(session.user.id).catch(() => null);
    if (quota && (payload.rows?.length ?? 0) > quota.remaining) {
      return withRefreshedSession(NextResponse.json({ error: t("generic"), code: "whatsapp_monthly_limit", remaining: quota.remaining }, { status: 429 }), session.token);
    }
  }

  try {
    const result = await applyPendingChange(session.user.id, payload, {
      origin: new URL(request.url).origin,
      cookie: request.headers.get("cookie") ?? "",
      locale: resolveLocale(request),
    });
    return withRefreshedSession(NextResponse.json({ result }), session.token);
  } catch (error) {
    if (error instanceof StaleChangeError) return withRefreshedSession(NextResponse.json({ error: error.message, code: "stale" }, { status: 409 }), session.token);
    if (error instanceof GmailNotConnectedError) return withRefreshedSession(NextResponse.json({ error: t("generic"), code: "needs_gmail" }, { status: 409 }), session.token);
    if (error instanceof CalendarNotConnectedError) return withRefreshedSession(NextResponse.json({ error: t("generic"), code: "needs_calendar" }, { status: 409 }), session.token);
    if (error instanceof WhatsAppNotConnectedError) return withRefreshedSession(NextResponse.json({ error: t("generic"), code: "needs_whatsapp" }, { status: 409 }), session.token);
    if (error instanceof WhatsAppUnavailableError) {
      console.error("Lead Suite confirm: WhatsApp worker", error.message);
      return withRefreshedSession(NextResponse.json({ error: t("generic"), code: "whatsapp_unavailable" }, { status: 503 }), session.token);
    }
    if (error instanceof InsufficientCreditsError) return withRefreshedSession(NextResponse.json({ error: t("generic"), code: "no_credits", available: error.available, required: error.required }, { status: 402 }), session.token);
    if (error instanceof CreditOperationBusyError) return withRefreshedSession(NextResponse.json({ error: t("generic"), code: "credit_busy" }, { status: 409 }), session.token);
    if (error instanceof GmailQuotaError) return withRefreshedSession(NextResponse.json({ error: t("generic"), code: "gmail_quota" }, { status: 429 }), session.token);
    if (error instanceof GmailValidationError || error instanceof CalendarValidationError) return withRefreshedSession(NextResponse.json({ error: t("generic"), code: "invalid" }, { status: 400 }), session.token);
    console.error("Lead Suite confirm failed", error);
    const detail = error instanceof Error ? error.message : String(error);
    return withRefreshedSession(NextResponse.json({ error: uiError(detail, t("generic")) }, { status: 502 }), session.token);
  }
}
