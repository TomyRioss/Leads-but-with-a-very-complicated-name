import { NextResponse, type NextRequest } from "next/server";
import { EXPLORE_TOKEN_COOKIE } from "@/lib/explore/types";
import { getRun, updateRun } from "@/lib/server/explore/store";
import { canonicalCountry } from "@/lib/server/explore/research";
import { editRateLimited } from "@/lib/server/explore/guard";

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

const SUMMARY_MAX = 400;
const LOCATION_MAX = 120;

/** PATCH /api/explore: the visitor corrects the step 1 card by hand (summary and location). A real change clears steps 2-5 so the page regenerates them. */
export async function PATCH(request: NextRequest) {
  const token = request.cookies.get(EXPLORE_TOKEN_COOKIE)?.value ?? "";
  if (!token || token.length > 200) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as { summary?: unknown; location?: unknown } | null;
  const summary = typeof body?.summary === "string" ? body.summary.trim() : "";
  const location = typeof body?.location === "string" ? body.location.trim() : "";
  if (!summary || summary.length > SUMMARY_MAX || location.length > LOCATION_MAX) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  try {
    const run = await getRun(token);
    if (!run?.product) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (summary === run.product.summary && location === run.product.location) return NextResponse.json({ product: run.product, reset: false });
    if (editRateLimited(request)) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    // Si la ubicación nueva no resuelve a un país, se conserva el país anterior para la búsqueda de leads.
    const country = location === run.product.location ? run.product.country : (await canonicalCountry(location)) || run.product.country;
    const product = { ...run.product, summary, location, country };
    await updateRun(token, { product, competitors: null, campaigns: null, leads: null, proposals: null, campaignId: "" });
    return NextResponse.json({ product, reset: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Explore edit failed:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
