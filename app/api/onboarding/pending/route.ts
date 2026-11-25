import { connection } from "next/server";
import { json, withUser } from "@/lib/server/workspace/http";
import { pendingOnboardingBusinessId } from "@/lib/server/workspace/active";

// GET /api/onboarding/pending → { businessId } ("" si el negocio activo ya completó el onboarding o no hay).
export async function GET(request: Request) {
  await connection();
  return withUser(request, "onboarding pending", async (user) => json({ businessId: await pendingOnboardingBusinessId(user.id) }));
}
