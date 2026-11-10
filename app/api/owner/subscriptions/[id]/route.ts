import { NextResponse } from "next/server";
import { getMercadoPagoClient, mapMercadoPagoSubscriptionStatus } from "@/lib/server/mercadopago";
import { requireOwner } from "@/lib/server/owner";
import { pocketBaseFetch } from "@/lib/server/pocketbase";
import { errorResponse, isNotFound, isValidRecordId, pocketBaseNotReady, readJsonObject, type SubscriptionRecord } from "../../_shared";

const allowedStatuses = ["authorized", "paused", "cancelled"] as const;
type AllowedStatus = (typeof allowedStatuses)[number];

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = (await requireOwner(request)) ?? pocketBaseNotReady();
  if (denied) return denied;
  const { id } = await context.params;
  if (!isValidRecordId(id)) return errorResponse("No encontramos esa suscripción.", 404);

  const body = await readJsonObject(request);
  if (!body) return errorResponse("El estado no es válido.", 400);
  const requested = allowedStatuses.find((status) => status === body.status);
  if (!requested) return errorResponse("El estado debe ser authorized, paused o cancelled.", 400);

  let subscription: SubscriptionRecord;
  try {
    subscription = await pocketBaseFetch<SubscriptionRecord>(`/api/collections/subscriptions/records/${id}`);
  } catch (error) {
    if (isNotFound(error)) return errorResponse("No encontramos esa suscripción.", 404);
    return errorResponse("No se pudo cargar la suscripción.", 502);
  }

  if (subscription.mp_subscription_id) {
    const client = getMercadoPagoClient();
    // Without the token a local-only change would diverge from Mercado Pago, which keeps charging.
    if (!client) return errorResponse("Falta configurar MP_ACCESS_TOKEN en el servidor.", 503);
    try {
      await client.update({ id: subscription.mp_subscription_id, body: { status: requested satisfies AllowedStatus } });
    } catch (error) {
      console.error("Owner Mercado Pago subscription update failed:", error instanceof Error ? error.name : "unknown");
      return errorResponse("No se pudo actualizar la suscripción en Mercado Pago.", 502);
    }
  }

  // Stored with the spelling the Mercado Pago webhook writes ("canceled").
  const status = mapMercadoPagoSubscriptionStatus(requested);
  try {
    await pocketBaseFetch(`/api/collections/subscriptions/records/${subscription.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    return NextResponse.json({ status });
  } catch (error) {
    console.error("Owner subscription save failed:", error instanceof Error ? error.name : "unknown");
    return errorResponse("No se pudo guardar el estado de la suscripción.", 502);
  }
}
