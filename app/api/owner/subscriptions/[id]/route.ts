import { NextResponse } from "next/server";
import { getSubscriptionPlan } from "@/lib/plans";
import { getMercadoPagoClient, mapMercadoPagoSubscriptionStatus } from "@/lib/server/mercadopago";
import { getOwnerSession } from "@/lib/server/owner";
import { recordOwnerAction } from "@/lib/server/owner-audit";
import { pocketBaseFetch } from "@/lib/server/pocketbase";
import { errorResponse, findUserSummary, isNotFound, isValidRecordId, pocketBaseNotReady, readJsonObject, type SubscriptionRecord } from "../../_shared";

const allowedStatuses = ["authorized", "paused", "cancelled"] as const;
const manualPlanIds = ["initial", "pro", "agency"];

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getOwnerSession(request);
  if ("response" in session) return session.response;
  const denied = pocketBaseNotReady();
  if (denied) return denied;
  const { id } = await context.params;
  if (!isValidRecordId(id)) return errorResponse("No encontramos esa suscripción.", 404);

  const body = await readJsonObject(request);
  if (!body) return errorResponse("Los datos no son válidos.", 400);
  const requestedStatus = body.status === undefined ? undefined : allowedStatuses.find((status) => status === body.status);
  if (body.status !== undefined && !requestedStatus) return errorResponse("El estado debe ser authorized, paused o cancelled.", 400);
  const requestedPlan = body.planId === undefined
    ? undefined
    : typeof body.planId === "string" && manualPlanIds.includes(body.planId) ? getSubscriptionPlan(body.planId) : null;
  if (requestedPlan === null) return errorResponse("El plan debe ser initial, pro o agency.", 400);
  if (!requestedStatus && !requestedPlan) return errorResponse("Enviá status o planId.", 400);

  let subscription: SubscriptionRecord;
  try {
    subscription = await pocketBaseFetch<SubscriptionRecord>(`/api/collections/subscriptions/records/${id}`);
  } catch (error) {
    if (isNotFound(error)) return errorResponse("No encontramos esa suscripción.", 404);
    return errorResponse("No se pudo cargar la suscripción.", 502);
  }

  if (requestedPlan && subscription.mp_subscription_id) {
    return errorResponse("El plan de una suscripción de Mercado Pago no se puede cambiar desde acá.", 409);
  }

  if (requestedStatus && subscription.mp_subscription_id) {
    const client = getMercadoPagoClient();
    // Without the token a local-only change would diverge from Mercado Pago, which keeps charging.
    if (!client) return errorResponse("Falta configurar MP_ACCESS_TOKEN en el servidor.", 503);
    try {
      await client.update({ id: subscription.mp_subscription_id, body: { status: requestedStatus } });
    } catch (error) {
      console.error("Owner Mercado Pago subscription update failed:", error instanceof Error ? error.name : "unknown");
      return errorResponse("No se pudo actualizar la suscripción en Mercado Pago.", 502);
    }
  }

  // Stored with the spelling the Mercado Pago webhook writes ("canceled").
  const status = requestedStatus ? mapMercadoPagoSubscriptionStatus(requestedStatus) : undefined;
  const save = () => pocketBaseFetch(`/api/collections/subscriptions/records/${subscription.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      ...(status ? { status } : {}),
      ...(requestedPlan ? { plan_id: requestedPlan.id, price_ars: requestedPlan.priceArs, monthly_credits: requestedPlan.credits } : {}),
    }),
  });
  let saveError: unknown = null;
  try {
    await save();
  } catch {
    try {
      await save();
    } catch (error) {
      saveError = error;
    }
  }
  if (saveError) {
    console.error("Owner subscription save failed:", saveError instanceof Error ? saveError.name : "unknown");
    const mercadoPagoChanged = Boolean(requestedStatus && subscription.mp_subscription_id);
    if (mercadoPagoChanged) {
      await recordOwnerAction(request, session.owner, {
        action: "subscription.status",
        targetType: "subscription",
        targetId: subscription.id,
        targetLabel: `${subscription.user} · ${subscription.plan_id}`,
        details: { status: { before: subscription.status, requested: status }, mercadoPago: true, dbSaveFailed: true },
      });
      return errorResponse("Mercado Pago cambió el estado pero no se pudo guardar en la base: quedaron desfasados. Reintentá el cambio.", 502);
    }
    return errorResponse("No se pudo guardar la suscripción.", 502);
  }

  const owner = await findUserSummary(subscription.user).catch(() => null);
  const targetLabel = `${owner?.email ?? subscription.user} · ${requestedPlan?.name ?? subscription.plan_id}`;
  if (status) {
    await recordOwnerAction(request, session.owner, {
      action: "subscription.status",
      targetType: "subscription",
      targetId: subscription.id,
      targetLabel,
      details: { status: { before: subscription.status, after: status }, mercadoPago: Boolean(subscription.mp_subscription_id) },
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
