import { NextResponse } from "next/server";
import { getCurrentUser, withRefreshedSession } from "@/lib/server/auth";
import { errorTranslator, resolveLocale } from "@/lib/server/locale";
import { runPeopleSearchRequest } from "@/lib/server/people/search-request";
import { peopleSearchDisabledResponse } from "../_shared";

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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: t("invalidRequestBody") }, { status: 400 });
  }
  const result = await runPeopleSearchRequest(session.user, body, { locale: resolveLocale(request), signal: request.signal });
  const response = NextResponse.json(result.body, { status: result.status, headers: result.headers });
  return result.refreshSession ? withRefreshedSession(response, session.token) : response;
}
