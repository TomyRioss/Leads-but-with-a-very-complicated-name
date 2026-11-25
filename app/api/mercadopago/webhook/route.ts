import { NextResponse } from "next/server";
import { isMercadoPagoConfigured, isValidWebhookSignature } from "@/lib/server/mercadopago";
import { isPocketBaseConfigured } from "@/lib/server/pocketbase";
import { handleMercadoPagoEvent } from "@/lib/server/subscriptions";

// Mercado Pago webhooks (topics subscription_preapproval, subscription_authorized_payment; others are acknowledged).
// The x-signature covers data.id (query string), x-request-id and ts, not the body. Non-2xx makes Mercado Pago retry,
// so only processing failures return 500.

export async function POST(request: Request) {
  if (!isMercadoPagoConfigured() || !isPocketBaseConfigured()) return new NextResponse(null, { status: 503 });

  const payload = await request.json().catch(() => null) as { type?: unknown; data?: { id?: unknown } } | null;
  const query = new URL(request.url).searchParams;
  const dataId = query.get("data.id") ?? (payload?.data?.id === undefined ? "" : String(payload.data.id));
  const signature = { signature: request.headers.get("x-signature") ?? "", requestId: request.headers.get("x-request-id") ?? "", dataId };
  if (!isValidWebhookSignature(signature)) return new NextResponse(null, { status: 401 });

  const topic = typeof payload?.type === "string" ? payload.type : query.get("type") ?? "";
  try {
    await handleMercadoPagoEvent(topic, dataId);
    return new NextResponse(null, { status: 200 });
  } catch (error) {
    console.error("Mercado Pago webhook failed", topic, error instanceof Error ? error.name : "unknown");
    return new NextResponse(null, { status: 500 });
  }
}
