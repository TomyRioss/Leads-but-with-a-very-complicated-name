import { NextResponse } from "next/server";
import type { Campaign } from "@/lib/campaigns";
import { invalidateCampaignCache, toCampaign } from "@/lib/server/campaigns";
import { errorTranslator } from "@/lib/server/locale";
import { getOwnerSession, type OwnerIdentity } from "@/lib/server/owner";
import { pocketBaseFetch } from "@/lib/server/pocketbase";
import { errorResponse, isNotFound, isValidRecordId, pocketBaseNotReady, readJsonObject } from "../../_shared";
import { campaignDetails, invalidField, parseCampaignInput, recordCampaignAction, toRecordBody, type CampaignInput } from "../_campaign";

type Context = { params: Promise<{ id: string }> };
type Loaded = { campaign: Campaign; owner: OwnerIdentity } | { response: NextResponse };

const recordPath = (id: string) => `/api/collections/campaigns/records/${id}`;

/** Owner session, PocketBase readiness, id format and the stored campaign, or the error response to return. */
async function loadCampaign(request: Request, context: Context): Promise<Loaded> {
  const t = errorTranslator(request);
  const session = await getOwnerSession(request);
  if ("response" in session) return session;
  const denied = pocketBaseNotReady(request);
  if (denied) return { response: denied };
  const { id } = await context.params;
  if (!isValidRecordId(id)) return { response: errorResponse(t("ownerInvalidData"), 404) };
  try {
    return { campaign: toCampaign(await pocketBaseFetch(recordPath(id))), owner: session.owner };
  } catch (error) {
    if (isNotFound(error)) return { response: errorResponse(t("ownerInvalidData"), 404) };
    console.error("Owner campaign load failed:", error instanceof Error ? error.name : "unknown");
    return { response: errorResponse(t("generic"), 502) };
  }
}

const withoutId = (campaign: Campaign): CampaignInput => {
  const { id, ...input } = campaign;
  void id;
  return input;
};

export async function PATCH(request: Request, context: Context) {
  const t = errorTranslator(request);
  const loaded = await loadCampaign(request, context);
  if ("response" in loaded) return loaded.response;
  const { campaign: stored, owner } = loaded;

  const body = await readJsonObject(request);
  if (!body) return errorResponse(t("ownerInvalidData"), 400);
  const before = withoutId(stored);
  const parsed = parseCampaignInput(body, before);
  if ("field" in parsed) return invalidField(request, parsed.field);

  let campaign;
  try {
    campaign = toCampaign(await pocketBaseFetch(recordPath(stored.id), { method: "PATCH", body: JSON.stringify(toRecordBody(parsed.input)) }));
  } catch (error) {
    if (isNotFound(error)) return errorResponse(t("ownerInvalidData"), 404);
    console.error("Owner campaign update failed:", error instanceof Error ? error.name : "unknown");
    return errorResponse(t("generic"), 502);
  }
  invalidateCampaignCache();
  const details = campaignDetails(parsed.input, before);
  if (Object.keys(details).length > 0) await recordCampaignAction(request, owner, "campaign.update", campaign, details);
  return NextResponse.json({ campaign });
}

export async function DELETE(request: Request, context: Context) {
  const t = errorTranslator(request);
  const loaded = await loadCampaign(request, context);
  if ("response" in loaded) return loaded.response;
  const { campaign, owner } = loaded;

  try {
    await pocketBaseFetch(recordPath(campaign.id), { method: "DELETE" });
  } catch (error) {
    if (isNotFound(error)) return errorResponse(t("ownerInvalidData"), 404);
    console.error("Owner campaign delete failed:", error instanceof Error ? error.name : "unknown");
    return errorResponse(t("generic"), 502);
  }
  invalidateCampaignCache();
  await recordCampaignAction(request, owner, "campaign.delete", campaign, campaignDetails(withoutId(campaign)));
  return NextResponse.json({ ok: true });
}
