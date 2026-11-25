import { NextResponse } from "next/server";
import { EXPLORE_TOKEN_COOKIE } from "@/lib/explore/types";
import { guardStart, parseExploreInput } from "@/lib/server/explore/guard";
import { createRun } from "@/lib/server/explore/store";

const COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

/** POST /api/explore/start {input, turnstileToken}: public (no login). Creates a run and sets its token cookie. */
export async function POST(request: Request) {
  let body: { input?: unknown; turnstileToken?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const input = parseExploreInput(body?.input);
  if (!input) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  try {
    const guard = await guardStart(request, body.turnstileToken);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
    const { token } = await createRun(input, guard.ipHash);
    const response = NextResponse.json({ ok: true });
    response.cookies.set(EXPLORE_TOKEN_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: COOKIE_MAX_AGE });
    return response;
  } catch (error) {
    console.error("Explore start failed:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "start_failed" }, { status: 503 });
  }
}
