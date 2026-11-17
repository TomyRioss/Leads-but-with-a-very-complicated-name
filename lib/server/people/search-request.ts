import { NextResponse } from "next/server";
import { CREDITS_PER_PERSON, type PeopleSearchResponse, parseCardKey } from "@/lib/people";
import type { AppUser } from "@/lib/server/auth";
import { aiRequestLimit } from "@/lib/server/ai-daily-limit";
import { apiResultFrom, type ApiResult } from "@/lib/server/api-result";
import { featurePricing } from "@/lib/server/campaigns";
import { CreditOperationBusyError, InsufficientCreditsError, reserveCreditAmount, settleCredits } from "@/lib/server/credits";
import { getTranslator, type Locale } from "@/lib/server/locale";
import { PeopleSearchAbortedError, runPeopleSearch } from "@/lib/server/people/search";
import { isPocketBaseConfigured } from "@/lib/server/pocketbase";
import { uiError } from "@/lib/server/public-error";
import { parsePeopleRequest, sensitiveSegmentResponse } from "@/app/api/people/_shared";

/** POST /api/people/search after auth: reserves credits, runs the search and charges only people delivered with contact. */
export async function runPeopleSearchRequest(user: Pick<AppUser, "id" | "role">, body: unknown, opts: { locale: Locale; signal?: AbortSignal }): Promise<ApiResult> {
  const t = getTranslator(opts.locale, "Errors");

  if (!isPocketBaseConfigured()) return { status: 503, body: { error: uiError(t("pocketbaseNotConfigured"), t("generic")) } };
  const limited = await aiRequestLimit(user, t);
  if (limited) return apiResultFrom(limited);

  const parsedRequest = parsePeopleRequest(body, opts.locale, t, true);
  if (parsedRequest instanceof NextResponse) return apiResultFrom(parsedRequest);
  const parsed = { ...parsedRequest, cardKey: parseCardKey((body as { cardKey?: unknown } | null)?.cardKey) };

  // Campaign discount read once: the same rate reserves and charges.
  const { cost } = await featurePricing("people_search", CREDITS_PER_PERSON);
  const reserved = cost(parsed.count);
  let reservation: Awaited<ReturnType<typeof reserveCreditAmount>> | null = null;
  try {
    reservation = await reserveCreditAmount(user.id, reserved);
    const result = await runPeopleSearch(user.id, parsed, opts.signal);
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
    return { status: 200, body: { ...response }, refreshSession: true };
  } catch (error) {
    // Nothing delivered: release() below refunds the whole reservation exactly once.
    if (error instanceof InsufficientCreditsError) {
      return { status: 402, body: { error: t("insufficientCredits", { required: error.required, available: error.available }), credits: error.available, required: error.required } };
    }
    if (error instanceof CreditOperationBusyError) return { status: 409, body: { error: t("creditBusy") } };
    const sensitive = sensitiveSegmentResponse(error, t);
    if (sensitive) return apiResultFrom(sensitive, true);
    if (error instanceof PeopleSearchAbortedError) return { status: 499, body: { error: t("peopleSearchAborted") } };
    console.error("People search failed:", error instanceof Error ? error.message : "unknown");
    return { status: 502, body: { error: uiError(error instanceof Error ? error.message : t("peopleSearchFailed"), t("peopleSearchFailed")) } };
  } finally {
    // Unsettled at release = full refund; settled = only frees the lock (settle is idempotent, no double refund).
    if (reservation) await reservation.release().catch(() => undefined);
  }
}
