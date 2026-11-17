import { NextResponse } from "next/server";
import { getCurrentUser, withRefreshedSession } from "@/lib/server/auth";
import { runLeadAnalysis } from "@/lib/server/lead-analysis";
import { errorTranslator, resolveLocale } from "@/lib/server/locale";

export const maxDuration = 300;

export async function POST(request: Request) {
  const t = errorTranslator(request);
  let session: Awaited<ReturnType<typeof getCurrentUser>>;
  try {
    session = await getCurrentUser(request);
  } catch {
    return NextResponse.json({ error: t("accountService") }, { status: 503 });
  }
  if (!session) return NextResponse.json({ error: t("signInToAnalyze") }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: t("invalidRequestBody") }, { status: 400 });
  }
  const result = await runLeadAnalysis(session.user, body, { locale: resolveLocale(request) });
  const response = NextResponse.json(result.body, { status: result.status, headers: result.headers });
  return result.refreshSession ? withRefreshedSession(response, session.token) : response;
}
