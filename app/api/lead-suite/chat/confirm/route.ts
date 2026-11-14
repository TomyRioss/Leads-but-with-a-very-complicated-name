import { NextResponse } from "next/server";
import { getCurrentUser, withRefreshedSession } from "@/lib/server/auth";
import { isPocketBaseConfigured } from "@/lib/server/pocketbase";
import { uiError } from "@/lib/server/public-error";
import { errorTranslator, resolveLocale } from "@/lib/server/locale";
import { applyPendingChange, StaleChangeError, verifyPendingChange } from "@/lib/server/lead-suite-agent";
import { withGoogleEdits, withKeywordSubset } from "@/lib/server/leadtita-tools";
import { GmailNotConnectedError, GmailQuotaError, GmailValidationError } from "@/lib/server/google-gmail";
import { CalendarNotConnectedError, CalendarValidationError } from "@/lib/server/google-calendar";

// Confirmed lead searches run here (through /api/search and /api/people/search), so allow their full duration.
export const maxDuration = 300;
// Import cards carry their signed rows (up to 2,000).
const MAX_BODY_BYTES = 3_000_000;

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
  let keywords: unknown;
  let edits: unknown;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: t("invalidRequestBody") }, { status: 413 });
    const body = JSON.parse(raw) as { token?: unknown; keywords?: unknown; edits?: unknown };
    token = body?.token;
    keywords = body?.keywords;
    edits = body?.edits;
  } catch {
    return NextResponse.json({ error: t("invalidRequestBody") }, { status: 400 });
  }
  // Stateless token, but single effect: applyPendingChange dedupes creations/searches and checks the signed record hash on edits.
  const verified = verifyPendingChange(token, session.user.id);
  // Optional edited keyword list: must be a non-empty subset of the signed keywords.
  // Optional card edits (email draft, meeting time): re-validated; only for email/meeting cards.
  const withKeywords = verified ? withKeywordSubset(verified, keywords) : null;
  const payload = withKeywords ? withGoogleEdits(withKeywords, edits) : null;
  if (!payload) return NextResponse.json({ error: t("invalidRequestBody") }, { status: 400 });

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
    if (error instanceof GmailQuotaError) return withRefreshedSession(NextResponse.json({ error: t("generic"), code: "gmail_quota" }, { status: 429 }), session.token);
    if (error instanceof GmailValidationError || error instanceof CalendarValidationError) return withRefreshedSession(NextResponse.json({ error: t("generic"), code: "invalid" }, { status: 400 }), session.token);
    console.error("Lead Suite confirm failed", error);
    const detail = error instanceof Error ? error.message : String(error);
    return withRefreshedSession(NextResponse.json({ error: uiError(detail, t("generic")) }, { status: 502 }), session.token);
  }
}
