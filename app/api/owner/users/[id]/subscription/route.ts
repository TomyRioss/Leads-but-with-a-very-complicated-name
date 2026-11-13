import { getOwnerSession } from "@/lib/server/owner";
import { errorTranslator } from "@/lib/server/locale";
import { errorResponse } from "../../../_shared";

// Subscriptions and plans are managed by the external billing system; owner cannot create them manually.
export async function POST(request: Request) {
  const t = errorTranslator(request);
  const session = await getOwnerSession(request);
  if ("response" in session) return session.response;
  return errorResponse(t("ownerPlansManagedExternally"), 405);
}
