import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server/auth";
import { getMercadoPagoClient, mapMercadoPagoSubscriptionStatus } from "@/lib/server/mercadopago";
import { isPocketBaseConfigured, pocketBaseFetch } from "@/lib/server/pocketbase";

type SubscriptionRecord = {
  id: string;
  user: string;
  plan_id: string;
  mp_subscription_id: string;
  status: string;
  price_ars: number;
  monthly_credits: number;
  checkout_url: string;
};

// Dynamic route: GET /api/subscriptions/:id reconciles the owner-scoped status.

async function getOwnedSubscription(id: string, userId: string) {
  try {
    const record = await pocketBaseFetch<SubscriptionRecord>(`/api/collections/subscriptions/records/${encodeURIComponent(id)}`);
    return record.user === userId ? record : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getCurrentUser(request).catch(() => null);
  if (!session) return NextResponse.json({ error: "Iniciá sesión para ver tu suscripción." }, { status: 401 });
  if (!isPocketBaseConfigured()) return NextResponse.json({ error: "La conexión con PocketBase no está lista." }, { status: 503 });
  const { id } = await context.params;
  const subscription = await getOwnedSubscription(id, session.user.id);
  if (!subscription) return NextResponse.json({ error: "No encontramos esa suscripción." }, { status: 404 });

  const client = getMercadoPagoClient();
  if (client && subscription.mp_subscription_id) {
    try {
      const remote = await client.get({ id: subscription.mp_subscription_id });
      const status = mapMercadoPagoSubscriptionStatus(remote.status);
      if (status !== subscription.status) {
        await pocketBaseFetch(`/api/collections/subscriptions/records/${subscription.id}`, {
          method: "PATCH",
          body: JSON.stringify({ status }),
        });
        subscription.status = status;
      }
    } catch (error) {
      console.error("Mercado Pago subscription status lookup failed:", error instanceof Error ? error.name : "unknown");
    }
  }

  return NextResponse.json({ subscription: {
    id: subscription.id,
    planId: subscription.plan_id,
    status: subscription.status,
    priceArs: subscription.price_ars,
    monthlyCredits: subscription.monthly_credits,
    checkoutUrl: subscription.checkout_url,
  } });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getCurrentUser(request).catch(() => null);
  if (!session) return NextResponse.json({ error: "Iniciá sesión para administrar tu suscripción." }, { status: 401 });
  if (!isPocketBaseConfigured()) return NextResponse.json({ error: "La conexión con PocketBase no está lista." }, { status: 503 });

  let body: { action?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "La acción no es válida." }, { status: 400 });
  }
  // Mercado Pago API uses "cancelled"; the local UI also handles "canceled".
  const statusByAction = { pause: "paused", reactivate: "authorized", cancel: "cancelled" } as const;
  if (typeof body.action !== "string" || !Object.hasOwn(statusByAction, body.action)) {
    return NextResponse.json({ error: "La acción debe ser pausar, reactivar o cancelar." }, { status: 400 });
  }

  const { id } = await context.params;
  const subscription = await getOwnedSubscription(id, session.user.id);
  if (!subscription || !subscription.mp_subscription_id) return NextResponse.json({ error: "No encontramos esa suscripción." }, { status: 404 });
  const client = getMercadoPagoClient();
  if (!client) return NextResponse.json({ error: "Falta configurar MP_ACCESS_TOKEN en el servidor." }, { status: 503 });

  try {
    const status = statusByAction[body.action as keyof typeof statusByAction];
    await client.update({ id: subscription.mp_subscription_id, body: { status } });
    await pocketBaseFetch(`/api/collections/subscriptions/records/${subscription.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    return NextResponse.json({ status });
  } catch (error) {
    console.error("Mercado Pago subscription update failed:", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ error: "No se pudo actualizar la suscripción en Mercado Pago." }, { status: 502 });
  }
}
