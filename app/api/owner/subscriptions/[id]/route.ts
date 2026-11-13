import { NextResponse } from "next/server";
import { getOwnerSession } from "@/lib/server/owner";
import { recordOwnerAction } from "@/lib/server/owner-audit";
import { pocketBaseFetch } from "@/lib/server/pocketbase";
import { errorResponse, findUserSummary, isNotFound, isValidRecordId, pocketBaseNotReady, readJsonObject, type SubscriptionRecord } from "../../_shared";
import { errorTranslator } from "@/lib/server/locale";

const allowedStatuses = ["authorized", "paused", "cancelled"] as const;

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
  const requestedStatus = body.status === undefined ? undefined : allowedStatuses.find((status) => status === body.status);
  if (body.status !== undefined && !requestedStatus) return errorResponse(t("ownerSubscriptionStatus"), 400);
  // Plans are managed by the external billing system: owner can only act on status.
  if (body.planId !== undefined) return errorResponse(t("ownerPlansManagedExternally"), 405);
  if (!requestedStatus) return errorResponse(t("ownerSubscriptionStatus"), 400);

  let subscription: SubscriptionRecord;
  try {
    subscription = await pocketBaseFetch<SubscriptionRecord>(`/api/collections/subscriptions/records/${id}`);
  } catch (error) {
    if (isNotFound(error)) return errorResponse(t("ownerSubscriptionNotFound"), 404);
    return errorResponse(t("ownerSubscriptionLoadFailed"), 502);
  }

  // Cancelled subscriptions are stored with the "canceled" spelling.
  const status = requestedStatus === "cancelled" ? "canceled" : requestedStatus;
  const save = () => pocketBaseFetch(`/api/collections/subscriptions/records/${subscription.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      status,
    }),
  });
  try {
    await save();
  } catch (error) {
    console.error("Owner subscription save failed:", error instanceof Error ? error.name : "unknown");
    return errorResponse(t("ownerSubscriptionSaveFailed"), 502);
  }

  const owner = await findUserSummary(subscription.user).catch(() => null);
  const targetLabel = `${owner?.email ?? subscription.user} · ${subscription.plan_id}`;
  await recordOwnerAction(request, session.owner, {
    action: "subscription.status",
    targetType: "subscription",
    targetId: subscription.id,
    targetLabel,
    details: { status: { before: subscription.status, after: status } },
  });
  return NextResponse.json({ status });
}
