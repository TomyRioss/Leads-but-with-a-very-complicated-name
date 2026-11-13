import { connection, NextResponse } from "next/server";
import { getCurrentUser, withRefreshedSession } from "@/lib/server/auth";
import { errorTranslator } from "@/lib/server/locale";
import { getReferralSummary } from "@/lib/server/referrals";

export async function GET(request: Request) {
  const t = errorTranslator(request);
  await connection();
  try {
    const session = await getCurrentUser(request);
    if (!session) return NextResponse.json({ error: t("signInToContinue") }, { status: 401 });
    const page = Math.min(Math.max(Math.trunc(Number(new URL(request.url).searchParams.get("page"))) || 1, 1), 1000);
    const summary = await getReferralSummary(session.user.id, page);
    return withRefreshedSession(NextResponse.json(summary, { headers: { "Cache-Control": "no-store" } }), session.token);
  } catch (error) {
    console.error("Leadta referrals failed:", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: t("accountService") }, { status: 503 });
  }
}
