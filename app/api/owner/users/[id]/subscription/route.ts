import { NextResponse } from "next/server";
import { getSubscriptionPlan } from "@/lib/plans";
import { getOwnerSession } from "@/lib/server/owner";
import { recordOwnerAction } from "@/lib/server/owner-audit";
import { pocketBaseFetch } from "@/lib/server/pocketbase";
import {
  activeSubscriptionStatuses,
  errorResponse,
  findUserSummary,
  filterString,
  isNotFound,
  isValidRecordId,
  listRecords,
  maxCredits,
  OwnerCreditsBusyError,
  pocketBaseNotReady,
  readJsonObject,
  toSubscriptionSummary,
  updateUserCredits,
  type SubscriptionRecord,
} from "../../../_shared";

const manualPlanIds = ["initial", "pro", "agency"];

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getOwnerSession(request);
  if ("response" in session) return session.response;
  const denied = pocketBaseNotReady();
  if (denied) return denied;
  const { id } = await context.params;
  if (!isValidRecordId(id)) return errorResponse("No encontramos ese usuario.", 404);

  const body = await readJsonObject(request);
  if (!body) return errorResponse("El plan no es válido.", 400);
  const plan = typeof body.planId === "string" && manualPlanIds.includes(body.planId) ? getSubscriptionPlan(body.planId) : undefined;
  if (!plan) return errorResponse("El plan debe ser initial, pro o agency.", 400);
  if (body.grantCredits !== undefined && typeof body.grantCredits !== "boolean") {
    return errorResponse("grantCredits debe ser verdadero o falso.", 400);
  }

  const statuses = activeSubscriptionStatuses.map((status) => `status = "${status}"`).join(" || ");
  const openSubscriptions = `user = ${filterString(id)} && (${statuses})`;
  const deleteSubscription = (subscriptionId: string) =>
    pocketBaseFetch(`/api/collections/subscriptions/records/${subscriptionId}`, { method: "DELETE" }).catch((error) => {
      console.error("Owner manual subscription rollback failed:", error instanceof Error ? error.name : "unknown");
    });

  try {
    const user = await findUserSummary(id);
    if (!user) return errorResponse("No encontramos ese usuario.", 404);

    const existing = await listRecords("subscriptions", { perPage: 1, filter: openSubscriptions, fields: "id" });
    if (existing.items.length > 0) return errorResponse("El usuario ya tiene una suscripción activa, pausada o pendiente.", 409);

    const subscription = await pocketBaseFetch<SubscriptionRecord>("/api/collections/subscriptions/records", {
      method: "POST",
      body: JSON.stringify({
        user: id,
        plan_id: plan.id,
        external_reference: `owner-${id}-${Date.now()}`,
        status: "authorized",
        price_ars: plan.priceArs,
        monthly_credits: plan.credits,
      }),
    });

    // Re-check after creating: of concurrent creations, only the oldest (ties broken by id) survives.
    const winner = await listRecords<{ id: string }>("subscriptions", { perPage: 1, sort: "created,id", filter: openSubscriptions, fields: "id" });
    if (winner.items[0] && winner.items[0].id !== subscription.id) {
      await deleteSubscription(subscription.id);
      return errorResponse("El usuario ya tiene una suscripción activa, pausada o pendiente.", 409);
    }

    let credits: number | undefined;
    let creditsBefore: number | undefined;
    if (body.grantCredits === true) {
      try {
        credits = (await updateUserCredits(id, (current) => {
          creditsBefore = current;
          return Math.min(current + plan.credits, maxCredits);
        })) ?? undefined;
      } catch (error) {
        await deleteSubscription(subscription.id);
        const busy = error instanceof OwnerCreditsBusyError;
        return errorResponse(
          busy ? error.message : "No se pudieron sumar los créditos; la suscripción no se creó.",
          busy ? 409 : 502,
        );
      }
    }

    await recordOwnerAction(request, session.owner, {
      action: "subscription.assign",
      targetType: "subscription",
      targetId: subscription.id,
      targetLabel: `${user.email} · ${plan.name}`,
      details: {
        userId: id,
        planId: plan.id,
        priceArs: plan.priceArs,
        monthlyCredits: plan.credits,
        grantCredits: body.grantCredits === true,
        ...(credits === undefined ? {} : { creditsBefore, creditsAfter: credits }),
      },
    });
    return NextResponse.json(
      { subscription: toSubscriptionSummary(subscription), ...(credits === undefined ? {} : { credits }) },
      { status: 201 },
    );
  } catch (error) {
    if (isNotFound(error)) return errorResponse("No encontramos ese usuario.", 404);
    console.error("Owner manual subscription failed:", error instanceof Error ? error.name : "unknown");
    return errorResponse("No se pudo crear la suscripción.", 502);
  }
}
