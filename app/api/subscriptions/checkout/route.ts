import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server/auth";
import { getSubscriptionPlan } from "@/lib/plans";
import { getApplicationUrl, getMercadoPagoClient } from "@/lib/server/mercadopago";
import { isPocketBaseConfigured, PocketBaseRequestError, pocketBaseFetch } from "@/lib/server/pocketbase";
import { uiError } from "@/lib/server/public-error";

type SubscriptionRecord = { id: string; status: string };

async function mpFetch(method: "POST", endpoint: "https://api.mercadopago.com/preapproval", body: unknown, accessToken: string) {
  return fetch(endpoint, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
}

async function listSubscriptions(userId: string) {
  const filter = encodeURIComponent(`user = "${userId}"`);
  return pocketBaseFetch<{ items: SubscriptionRecord[] }>(`/api/collections/subscriptions/records?perPage=50&sort=-created&filter=${filter}`);
}

export async function POST(request: Request) {
  const session = await getCurrentUser(request).catch(() => null);
  if (!session) return NextResponse.json({ error: "Iniciá sesión para suscribirte." }, { status: 401 });

  let body: { planId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Elegí un plan válido." }, { status: 400 });
  }

  const trustedOffer = typeof body.planId === "string" ? getSubscriptionPlan(body.planId) : undefined;
  if (!trustedOffer) return NextResponse.json({ error: "El plan seleccionado no existe." }, { status: 400 });
  if (!isPocketBaseConfigured()) return NextResponse.json({ error: uiError("La conexión con PocketBase no está lista.") }, { status: 503 });

  const mercadoPago = getMercadoPagoClient();
  if (!mercadoPago) return NextResponse.json({ error: uiError("Falta configurar MP_ACCESS_TOKEN en el servidor.") }, { status: 503 });
  const accessToken = process.env.MP_ACCESS_TOKEN?.trim();
  if (!process.env.MP_WEBHOOK_SECRET?.trim() || !accessToken) return NextResponse.json({ error: uiError("Falta configurar el token y el secreto de Webhooks antes de habilitar pagos.") }, { status: 503 });
  if (process.env.NODE_ENV === "production" && !process.env.APP_URL?.trim()) return NextResponse.json({ error: uiError("Falta configurar APP_URL para volver del checkout.") }, { status: 503 });
  let appUrl: URL;
  try {
    appUrl = new URL(getApplicationUrl(request));
  } catch {
    return NextResponse.json({ error: "APP_URL debe ser una URL válida." }, { status: 503 });
  }
  if (process.env.NODE_ENV === "production" && appUrl.protocol !== "https:") {
    return NextResponse.json({ error: "APP_URL debe usar HTTPS en producción." }, { status: 503 });
  }

  let lockId = "";
  let subscriptionId = "";
  let remoteSubscriptionId = "";
  try {
    const lock = await pocketBaseFetch<{ id: string }>("/api/collections/subscription_checkout_locks/records", {
      method: "POST",
      body: JSON.stringify({ user: session.user.id }),
    });
    lockId = lock.id;

    const existing = await listSubscriptions(session.user.id);
    if (existing.items.some((item) => ["creating", "pending", "authorized", "paused"].includes(item.status))) {
      return NextResponse.json({ error: "Ya tenés una suscripción pendiente o activa. Revisala antes de iniciar otra." }, { status: 409 });
    }

    const externalReference = `leadta_${randomUUID()}`;
    const localSubscription = await pocketBaseFetch<{ id: string }>("/api/collections/subscriptions/records", {
      method: "POST",
      body: JSON.stringify({
        user: session.user.id,
        plan_id: trustedOffer.id,
        external_reference: externalReference,
        mp_subscription_id: "",
        status: "creating",
        price_ars: trustedOffer.priceArs,
        monthly_credits: trustedOffer.credits,
      }),
    });
    subscriptionId = localSubscription.id;

    const backUrl = new URL("/pricing", appUrl);
    backUrl.searchParams.set("subscription", localSubscription.id);
    const createBody = {
        reason: `Leadta ${trustedOffer.name}`,
        external_reference: externalReference,
        payer_email: session.user.email,
        auto_recurring: {
          frequency: 1,
          frequency_type: "months",
          transaction_amount: trustedOffer.priceArs,
          currency_id: "ARS",
        },
        back_url: backUrl.toString(),
        status: "pending",
    };
    // The official Mercado Pago SDK remains in use for subscription lookup and lifecycle actions.
    const response = await mpFetch("POST", "https://api.mercadopago.com/preapproval", createBody, accessToken);
    if (!response.ok) throw new Error(`Mercado Pago rejected subscription creation with status ${response.status}.`);
    const created = await response.json() as { id?: string; init_point?: string; status?: string };

    if (!created.id || !created.init_point) throw new Error("Mercado Pago no devolvió el enlace de autorización.");
    remoteSubscriptionId = String(created.id);
    await pocketBaseFetch(`/api/collections/subscriptions/records/${localSubscription.id}`, {
      method: "PATCH",
      body: JSON.stringify({ mp_subscription_id: String(created.id), checkout_url: created.init_point, status: created.status || "pending" }),
    });

    return NextResponse.json({ initPoint: created.init_point });
  } catch (error) {
    if (error instanceof PocketBaseRequestError && error.status === 400 && !subscriptionId) {
      return NextResponse.json({ error: "Ya hay un proceso de suscripción abierto para esta cuenta." }, { status: 409 });
    }
    if (remoteSubscriptionId) {
      await mercadoPago.update({ id: remoteSubscriptionId, body: { status: "cancelled" } }).catch(() => undefined);
    }
    if (subscriptionId) {
      await pocketBaseFetch(`/api/collections/subscriptions/records/${subscriptionId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "failed" }),
      }).catch(() => undefined);
    }
    console.error("Mercado Pago subscription checkout failed:", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ error: "No se pudo iniciar el pago. Verificá la configuración de Mercado Pago e intentá otra vez." }, { status: 502 });
  } finally {
    if (lockId) await pocketBaseFetch(`/api/collections/subscription_checkout_locks/records/${lockId}`, { method: "DELETE" }).catch(() => undefined);
  }
}
