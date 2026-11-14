import { NextResponse } from "next/server";
import { isDevFeatureEnabled } from "@/lib/env-features";
import type { PeopleSearchRequest } from "@/lib/people";
import type { Translator } from "@/lib/server/locale";
import { SensitiveSegmentError } from "@/lib/server/people/planner";

/** Validates the shared body of /api/people/plan and /api/people/search. Returns a 400 response on bad input. */
export function parsePeopleRequest(body: unknown, fallbackLocale: "es" | "en", t: Translator, withCount: boolean): PeopleSearchRequest | NextResponse {
  const input = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const query = typeof input.query === "string" ? input.query.trim() : "";
  const location = typeof input.location === "string" ? input.location.trim() : "";
  const count = withCount ? input.count : 1;
  const locale = input.locale === "es" || input.locale === "en" ? input.locale : fallbackLocale;
  if (query.length < 3 || query.length > 300) return NextResponse.json({ error: t("peopleQueryInvalid") }, { status: 400 });
  if (location.length > 160) return NextResponse.json({ error: t("peopleLocationInvalid") }, { status: 400 });
  if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > 25) {
    return NextResponse.json({ error: t("peopleCountInvalid") }, { status: 400 });
  }
  if (input.includeMeta !== undefined && typeof input.includeMeta !== "boolean") {
    return NextResponse.json({ error: t("invalidRequestBody") }, { status: 400 });
  }
  return { query, location, count, locale, includeMeta: input.includeMeta !== false };
}

export function sensitiveSegmentResponse(error: unknown, t: Translator) {
  if (!(error instanceof SensitiveSegmentError)) return null;
  return NextResponse.json({ error: t("peopleSensitiveSegment"), code: "sensitive_segment", suggestion: error.suggestion }, { status: 422 });
}

/** People search is the dev feature `people_search`: 404 while it's off in this environment. */
export function peopleSearchDisabledResponse() {
  return isDevFeatureEnabled("people_search") ? null : new NextResponse(null, { status: 404 });
}
