import { NextResponse } from "next/server";
import { isValidWebhookSignature } from "@/lib/server/mercadopago";
import { isPocketBaseConfigured } from "@/lib/server/pocketbase";
import { handleMercadoPagoNotification } from "@/lib/server/subscriptions";

// Mercado Pago webhooks (topics: subscription_preapproval, subscription_authorized_payment, payment).
// Signed with MP_WEBHOOK_SECRET; data.id comes from the query string, as the signature manifest expects.
// Non-2xx makes MP retry, so only processing failures return 500.

const DATA_ID = /^[A-Za-z0-9_-]{1,64}$/;

export async function POST(request: Request) {
  if (!process.env.MP_WEBHOOK_SECRET?.trim() || !isPocketBaseConfigured()) return new NextResponse(null, { status: 503 });

  const url = new URL(request.url);
  const body = await request.json().catch(() => ({})) as { type?: unknown; data?: { id?: unknown } };
  const dataId = url.searchParams.get("data.id") ?? (body.data?.id === undefined ? "" : String(body.data.id));
  const type = url.searchParams.get("type") ?? (typeof body.type === "string" ? body.type : "");
  if (!DATA_ID.test(dataId)) return new NextResponse(null, { status: 400 });
  if (!isValidWebhookSignature(request.headers.get("x-signature") ?? "", request.headers.get("x-request-id") ?? "", dataId)) {
    return new NextResponse(null, { status: 401 });
  }

  try {
    await handleMercadoPagoNotification(type, dataId);
    return new NextResponse(null, { status: 200 });
  } catch (error) {
    console.error("Mercado Pago webhook failed", type, error instanceof Error ? error.name : "unknown");
    return new NextResponse(null, { status: 500 });
  }
}
