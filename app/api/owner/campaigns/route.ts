import { NextResponse } from "next/server";
import { invalidateCampaignCache, listCampaigns, toCampaign } from "@/lib/server/campaigns";
import { errorTranslator } from "@/lib/server/locale";
import { getOwnerSession, requireOwner } from "@/lib/server/owner";
import { pocketBaseFetch } from "@/lib/server/pocketbase";
import { errorResponse, pocketBaseNotReady, readJsonObject } from "../_shared";
import { campaignDetails, invalidField, parseCampaignInput, recordCampaignAction, toRecordBody } from "./_campaign";

export async function GET(request: Request) {
  const t = errorTranslator(request);
  const denied = (await requireOwner(request)) ?? pocketBaseNotReady(request);
  if (denied) return denied;
  try {
    return NextResponse.json({ items: await listCampaigns() });
  } catch (error) {
    console.error("Owner campaigns list failed:", error instanceof Error ? error.name : "unknown");
    return errorResponse(t("generic"), 502);
  }
}

export async function POST(request: Request) {
  const t = errorTranslator(request);
  const session = await getOwnerSession(request);
  if ("response" in session) return session.response;
  const denied = pocketBaseNotReady(request);
  if (denied) return denied;

  const body = await readJsonObject(request);
  if (!body) return errorResponse(t("ownerInvalidData"), 400);
  const parsed = parseCampaignInput(body);
  if ("field" in parsed) return invalidField(request, parsed.field);

  let campaign;
  try {
    campaign = toCampaign(await pocketBaseFetch(`/api/collections/campaigns/records`, { method: "POST", body: JSON.stringify(toRecordBody(parsed.input)) }));
  } catch (error) {
    console.error("Owner campaign create failed:", error instanceof Error ? error.name : "unknown");
    return errorResponse(t("generic"), 502);
  }
  invalidateCampaignCache();
  await recordCampaignAction(request, session.owner, "campaign.create", campaign, campaignDetails(parsed.input));
  return NextResponse.json({ campaign }, { status: 201 });
}
