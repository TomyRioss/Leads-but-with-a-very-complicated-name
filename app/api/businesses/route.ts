import { connection } from "next/server";
import { getActiveBusinessId } from "@/lib/server/workspace/active";
import { json, withUser } from "@/lib/server/workspace/http";
import { listBusinesses } from "@/lib/server/workspace/repository";

export async function GET(request: Request) {
  await connection();
  return withUser(request, "businesses list", async (user) => {
    const [businesses, activeId] = await Promise.all([listBusinesses(user.id), getActiveBusinessId(user.id)]);
    return json({ businesses, activeId });
  });
}
