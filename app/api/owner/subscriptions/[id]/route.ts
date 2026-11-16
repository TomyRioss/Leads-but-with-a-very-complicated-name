import { NextResponse } from "next/server";
import { getOwnerSession } from "@/lib/server/owner";
import { OWNER_SUBSCRIPTION_STATUSES, setOwnerSubscriptionStatus } from "@/lib/server/owner-actions";
import { errorResponse, isValidRecordId, pocketBaseNotReady, readJsonObject } from "../../_shared";
import { errorTranslator } from "@/lib/server/locale";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const t = errorTranslator(request);
  const session = await getOwnerSession(request);
  if ("response" in session) return session.response;
  const denied = pocketBaseNotReady(request);
  if (denied) return denied;
  const { id } = await context.params;
  if (!isValidRecordId(id)) return errorResponse(t("ownerSubscriptionNotFound"), 404);

  const body = await readJsonObject(request);
  if (!body) return errorResponse(t("ownerInvalidData"), 400);
  const requestedStatus = body.status === undefined ? undefined : OWNER_SUBSCRIPTION_STATUSES.find((status) => status === body.status);
  if (body.status !== undefined && !requestedStatus) return errorResponse(t("ownerSubscriptionStatus"), 400);
  // Plans are managed by the external billing system: owner can only act on status.
  if (body.planId !== undefined) return errorResponse(t("ownerPlansManagedExternally"), 405);
  if (!requestedStatus) return errorResponse(t("ownerSubscriptionStatus"), 400);

  const result = await setOwnerSubscriptionStatus(request, session.owner, id, requestedStatus);
  return result.ok ? NextResponse.json(result.value) : errorResponse(t(result.error), result.status);
}
