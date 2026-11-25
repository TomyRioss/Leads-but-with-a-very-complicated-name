import { connection } from "next/server";
import { getActiveBusinessId, listBusinessesWithProfile } from "@/lib/server/workspace/active";
import { json, withUser } from "@/lib/server/workspace/http";

export async function GET(request: Request) {
  await connection();
  return withUser(request, "businesses list", async (user) => {
    // En serie: si se crea el negocio desde el perfil, el activo se lee después.
    const businesses = await listBusinessesWithProfile(user.id);
    const activeId = await getActiveBusinessId(user.id);
    return json({ businesses, activeId });
  });
}
