import { connection, NextResponse } from "next/server";
import { clearSessionCookie, getCurrentUser, withRefreshedSession } from "@/lib/server/auth";
import { errorTranslator } from "@/lib/server/locale";

export async function GET(request: Request) {
  const t = errorTranslator(request);
  await connection();
  try {
    const session = await getCurrentUser(request);
    const response = NextResponse.json({ user: session?.user ?? null });
    if (session) return withRefreshedSession(response, session.token);
    clearSessionCookie(response);
    return response;
  } catch {
    return NextResponse.json({ error: t("accountService") }, { status: 503 });
  }
}
