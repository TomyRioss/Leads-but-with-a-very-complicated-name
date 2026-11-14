import { NextResponse } from "next/server";
import { CREDITS_PER_PERSON } from "@/lib/people";
import { getCurrentUser, withRefreshedSession } from "@/lib/server/auth";
import { errorTranslator, resolveLocale } from "@/lib/server/locale";
import { planPeopleSearch } from "@/lib/server/people/planner";
import { uiError } from "@/lib/server/public-error";
import { parsePeopleRequest, peopleSearchDisabledResponse, sensitiveSegmentResponse } from "../_shared";

export const maxDuration = 60;

/** Free preview: what the planner understood and the maximum cost of the requested count. */
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
  if (!session) return NextResponse.json({ error: t("signInToContinue") }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: t("invalidRequestBody") }, { status: 400 });
  }
  const hasCount = Boolean(body && typeof body === "object" && "count" in body);
  const parsed = parsePeopleRequest(body, resolveLocale(request), t, hasCount);
  if (parsed instanceof NextResponse) return parsed;

  try {
    const plan = await planPeopleSearch(parsed.query, parsed.location, parsed.locale, session.user.id);
    return withRefreshedSession(NextResponse.json({ plan, estimatedCredits: parsed.count * CREDITS_PER_PERSON }), session.token);
  } catch (error) {
    const sensitive = sensitiveSegmentResponse(error, t);
    if (sensitive) return withRefreshedSession(sensitive, session.token);
    console.error("People plan failed:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: uiError(t("peoplePlanFailed"), t("generic")) }, { status: 502 });
  }
}
