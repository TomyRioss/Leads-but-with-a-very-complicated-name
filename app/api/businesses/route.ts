import { connection } from "next/server";
import { json, withUser } from "@/lib/server/workspace/http";
import { listBusinesses } from "@/lib/server/workspace/repository";

export async function GET(request: Request) {
  await connection();
  return withUser(request, "businesses list", async (user) => json({ businesses: await listBusinesses(user.id) }));
}
