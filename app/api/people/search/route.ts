import { NextResponse } from "next/server";
import { CREDITS_PER_PERSON, type PeopleSearchResponse, parseCardKey } from "@/lib/people";
import { getCurrentUser, withRefreshedSession } from "@/lib/server/auth";
import { aiRequestLimit } from "@/lib/server/ai-daily-limit";
import { featurePricing } from "@/lib/server/campaigns";
import { CreditOperationBusyError, InsufficientCreditsError, reserveCreditAmount, settleCredits } from "@/lib/server/credits";
import { errorTranslator, resolveLocale } from "@/lib/server/locale";
import { PeopleSearchAbortedError, runPeopleSearch } from "@/lib/server/people/search";
import { isPocketBaseConfigured } from "@/lib/server/pocketbase";
import { uiError } from "@/lib/server/public-error";
import { parsePeopleRequest, peopleSearchDisabledResponse, sensitiveSegmentResponse } from "../_shared";

// Apify sources can take minutes; the search itself stops at PEOPLE_SEARCH_DEADLINE_MS.
export const maxDuration = 300;

export async function POST(request: Request) {
  const disabled = peopleSearchDisabledResponse();
  if (disabled) return disabled;
  const t = errorTranslator(request);
  let session: Awaited<ReturnType<typeof getCurrentUser>>;
  try {
    session = await getCurrentUser(request);
  } catch {
    return NextResponse.json({ error: t("accountService") }, { status: 503 });
  }
  if (!session) return NextResponse.json({ error: t("signInToSearch") }, { status: 401 });
  if (!isPocketBaseConfigured()) return NextResponse.json({ error: uiError(t("pocketbaseNotConfigured"), t("generic")) }, { status: 503 });
  const limited = await aiRequestLimit(session.user, t);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: t("invalidRequestBody") }, { status: 400 });
  }
  const parsedRequest = parsePeopleRequest(body, resolveLocale(request), t, true);
  if (parsedRequest instanceof NextResponse) return parsedRequest;
  const parsed = { ...parsedRequest, cardKey: parseCardKey((body as { cardKey?: unknown } | null)?.cardKey) };

  // Campaign discount read once: the same rate reserves and charges.
  const { cost } = await featurePricing("people_search", CREDITS_PER_PERSON);
  const reserved = cost(parsed.count);
  let reservation: Awaited<ReturnType<typeof reserveCreditAmount>> | null = null;
  try {
    reservation = await reserveCreditAmount(session.user.id, reserved);
    const result = await runPeopleSearch(session.user.id, parsed, request.signal);
    // Charge only people delivered with contact; the rest of the reservation goes back.
    const { charged, refund } = settleCredits(reserved, cost(result.leads.length));
    const credits = await reservation.settle(charged);
    const response: PeopleSearchResponse & { credits: number; failedSources: string[] } = {
      batchId: result.batchId,
      plan: result.plan,
      delivered: result.leads.length,
      charged,
      refunded: refund,
      leads: result.leads,
      credits,
      failedSources: result.failedSources,
    };
    return withRefreshedSession(NextResponse.json(response), session.token);
  } catch (error) {
    // Nothing delivered: release() below refunds the whole reservation exactly once.
    if (error instanceof InsufficientCreditsError) {
      return NextResponse.json({ error: t("insufficientCredits", { required: error.required, available: error.available }), credits: error.available, required: error.required }, { status: 402 });
    }
    if (error instanceof CreditOperationBusyError) return NextResponse.json({ error: t("creditBusy") }, { status: 409 });
    const sensitive = sensitiveSegmentResponse(error, t);
    if (sensitive) return withRefreshedSession(sensitive, session.token);
    if (error instanceof PeopleSearchAbortedError) return NextResponse.json({ error: t("peopleSearchAborted") }, { status: 499 });
    console.error("People search failed:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: uiError(error instanceof Error ? error.message : t("peopleSearchFailed"), t("peopleSearchFailed")) }, { status: 502 });
  } finally {
    // Unsettled at release = full refund; settled = only frees the lock (settle is idempotent, no double refund).
    if (reservation) await reservation.release().catch(() => undefined);
  }
}
