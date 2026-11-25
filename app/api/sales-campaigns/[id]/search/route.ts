import { NextResponse } from "next/server";
import { resolveLocale } from "@/lib/server/locale";
import { json, readJson, withUser } from "@/lib/server/workspace/http";
import { searchCampaignLeads } from "@/lib/server/workspace/service";

export const maxDuration = 300;
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  return withUser(request, "campaign search", async (user) => {
    const body = await readJson(request);
    if (body === undefined) return json({ error: "invalid_request" }, 400);
    const result = await searchCampaignLeads(user, id, body, resolveLocale(request));
    return NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store", ...result.headers } });
  });
}
