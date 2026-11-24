import { NextResponse } from "next/server";
import { isRebillConfigured, isValidWebhookSignature } from "@/lib/server/rebill";
import { isPocketBaseConfigured } from "@/lib/server/pocketbase";
import { handleRebillEvent } from "@/lib/server/subscriptions";

// Rebill webhooks (subscription.created/updated, payment.created/updated). The signature covers the raw body, so it is
// read as text before parsing. Non-2xx makes Rebill retry (5 min, 1 h, 1 day), so only processing failures return 500.

export async function POST(request: Request) {
  if (!isRebillConfigured() || !isPocketBaseConfigured()) return new NextResponse(null, { status: 503 });

  const rawBody = await request.text();
  if (!isValidWebhookSignature(request.headers.get("x-rebill-signature") ?? "", rawBody)) return new NextResponse(null, { status: 401 });

  let payload: { data?: unknown; webhook?: { event?: unknown } };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  const event = typeof payload.webhook?.event === "string" ? payload.webhook.event : "";
  const data = payload.data && typeof payload.data === "object" ? (payload.data as Record<string, unknown>) : {};

  try {
    await handleRebillEvent(event, data);
    return new NextResponse(null, { status: 200 });
  } catch (error) {
    console.error("Rebill webhook failed", event, error instanceof Error ? error.name : "unknown");
    return new NextResponse(null, { status: 500 });
  }
}
