import { NextResponse, type NextRequest } from "next/server";
import { EXPLORE_TOKEN_COOKIE } from "@/lib/explore/types";
import { getRun } from "@/lib/server/explore/store";

/** GET /api/explore: the visitor's run (from the token cookie) without the token, or 404. */
export async function GET(request: NextRequest) {
  const token = request.cookies.get(EXPLORE_TOKEN_COOKIE)?.value ?? "";
  if (!token || token.length > 200) return NextResponse.json({ error: "not_found" }, { status: 404 });
  try {
    const run = await getRun(token);
    if (!run) return NextResponse.json({ error: "not_found" }, { status: 404 });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { token: _token, ...visible } = run;
    return NextResponse.json(visible, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Explore get failed:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
