import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server/auth";
import { isPocketBaseConfigured, pocketBaseFetch } from "@/lib/server/pocketbase";
import { uiError } from "@/lib/server/public-error";

type SubscriptionRecord = {
  id: string;
  plan_id: string;
  status: string;
  price_ars: number;
  monthly_credits: number;
  checkout_url: string;
};

export async function GET(request: Request) {
  const session = await getCurrentUser(request).catch(() => null);
  if (!session) return NextResponse.json({ subscription: null });
  if (!isPocketBaseConfigured()) return NextResponse.json({ error: uiError("La conexión con PocketBase no está lista.") }, { status: 503 });

  const filter = encodeURIComponent(`user = "${session.user.id}"`);
  try {
    const response = await pocketBaseFetch<{ items: SubscriptionRecord[] }>(
      `/api/collections/subscriptions/records?perPage=50&sort=-created&filter=${filter}`,
    );
    const subscription = response.items.find((record) => ["creating", "pending", "authorized", "paused"].includes(record.status));
    return NextResponse.json({ subscription: subscription ? {
      id: subscription.id,
      planId: subscription.plan_id,
      status: subscription.status,
      priceArs: subscription.price_ars,
      monthlyCredits: subscription.monthly_credits,
      checkoutUrl: subscription.checkout_url,
    } : null });
  } catch {
    return NextResponse.json({ error: uiError("Aplicá las migraciones de PocketBase para activar suscripciones.") }, { status: 503 });
  }
}
