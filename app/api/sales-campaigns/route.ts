import { connection } from "next/server";
import { json, withUser } from "@/lib/server/workspace/http";
import { isRecordId } from "@/lib/server/workspace/mapping";
import { listCampaigns } from "@/lib/server/workspace/repository";

export async function GET(request: Request) {
  await connection();
  return withUser(request, "campaigns list", async (user) => {
    const business = new URL(request.url).searchParams.get("business");
    if (business !== null && !isRecordId(business)) return json({ error: "invalid_request" }, 400);
    return json({ campaigns: await listCampaigns(user.id, business ?? undefined) });
  });
}
