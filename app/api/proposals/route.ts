import { connection } from "next/server";
import { json, withUser } from "@/lib/server/workspace/http";
import { isRecordId } from "@/lib/server/workspace/mapping";
import { listProposals } from "@/lib/server/workspace/repository";

export async function GET(request: Request) {
  await connection();
  return withUser(request, "proposals list", async (user) => {
    const params = new URL(request.url).searchParams;
    const campaignId = params.get("campaign") ?? undefined;
    const businessId = params.get("business") ?? undefined;
    if ((campaignId !== undefined && !isRecordId(campaignId)) || (businessId !== undefined && !isRecordId(businessId))) return json({ error: "invalid_request" }, 400);
    return json({ proposals: await listProposals(user.id, { campaignId, businessId }) });
  });
}
