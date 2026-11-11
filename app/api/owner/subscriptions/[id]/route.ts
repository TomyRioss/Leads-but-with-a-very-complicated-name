import { NextResponse } from "next/server";
import { getSubscriptionPlan } from "@/lib/plans";
import { getOwnerSession } from "@/lib/server/owner";
import { recordOwnerAction } from "@/lib/server/owner-audit";
import { pocketBaseFetch } from "@/lib/server/pocketbase";
import { errorResponse, findUserSummary, isNotFound, isValidRecordId, pocketBaseNotReady, readJsonObject, type SubscriptionRecord } from "../../_shared";
import { errorTranslator } from "@/lib/server/locale";

const allowedStatuses = ["authorized", "paused", "cancelled"] as const;
const manualPlanIds = ["initial", "pro", "agency"];

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
  const requestedPlan = body.planId === undefined
    ? undefined
    : typeof body.planId === "string" && manualPlanIds.includes(body.planId) ? getSubscriptionPlan(body.planId) : null;
  if (requestedPlan === null) return errorResponse(t("ownerPlanInvalid"), 400);
  if (!requestedStatus && !requestedPlan) return errorResponse(t("ownerSendStatusOrPlan"), 400);

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
      ...(status ? { status } : {}),
      ...(requestedPlan ? { plan_id: requestedPlan.id, price_ars: requestedPlan.priceArs, monthly_credits: requestedPlan.credits } : {}),
    }),
  });
  try {
    await save();
  } catch (error) {
    console.error("Owner subscription save failed:", error instanceof Error ? error.name : "unknown");
    return errorResponse(t("ownerSubscriptionSaveFailed"), 502);
  }

  const owner = await findUserSummary(subscription.user).catch(() => null);
  const targetLabel = `${owner?.email ?? subscription.user} · ${requestedPlan?.name ?? subscription.plan_id}`;
  if (status) {
    await recordOwnerAction(request, session.owner, {
      action: "subscription.status",
      targetType: "subscription",
      targetId: subscription.id,
      targetLabel,
      details: { status: { before: subscription.status, after: status } },
    });
  }
  if (requestedPlan) {
    await recordOwnerAction(request, session.owner, {
      action: "subscription.plan",
      targetType: "subscription",
      targetId: subscription.id,
      targetLabel,
      details: {
        planId: { before: subscription.plan_id, after: requestedPlan.id },
        priceArs: { before: subscription.price_ars, after: requestedPlan.priceArs },
        monthlyCredits: { before: subscription.monthly_credits, after: requestedPlan.credits },
      },
    });
  }
  return NextResponse.json({ ...(status ? { status } : {}), ...(requestedPlan ? { planId: requestedPlan.id } : {}) });
}
