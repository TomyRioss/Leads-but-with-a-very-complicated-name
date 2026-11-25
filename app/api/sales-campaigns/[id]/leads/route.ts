import { connection } from "next/server";
import { json, withUser } from "@/lib/server/workspace/http";
import { getCampaign, listCampaignLeads } from "@/lib/server/workspace/repository";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  await connection();
  const { id } = await context.params;
  return withUser(request, "campaign leads", async (user) => {
    const campaign = await getCampaign(user.id, id);
    if (!campaign) return json({ error: "not_found" }, 404);
    return json({ leads: await listCampaignLeads(user.id, campaign.batchIds) });
  });
}
