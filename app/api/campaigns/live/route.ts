import { connection, NextResponse } from "next/server";
import { getLiveCampaigns } from "@/lib/server/campaigns";

/** Public: live campaign banner + per-feature discount. No auth; fails open to "no campaign". */
export async function GET() {
  await connection();
  return NextResponse.json(await getLiveCampaigns(), {
    headers: { "Cache-Control": "public, max-age=60, s-maxage=60" },
  });
}
