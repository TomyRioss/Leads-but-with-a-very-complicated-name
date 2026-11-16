import { NextResponse } from "next/server";
import { getCurrentUser, withRefreshedSession } from "@/lib/server/auth";
import { sameOrigin } from "@/lib/server/leadtita-conversations";
import { isMercadoPagoConfigured } from "@/lib/server/mercadopago";
import { cancelUserSubscriptions, getCurrentSubscription, startCheckout, SubscriptionError } from "@/lib/server/subscriptions";

// The session user's paid plan: GET current, POST { planId } → Mercado Pago checkout URL, DELETE cancels it.
// Errors are codes ({ error }); the client translates them.

const statusOf: Record<SubscriptionError["code"], number> = { invalid_plan: 400, already_subscribed: 409, checkout_busy: 409, not_found: 404, mercadopago: 502 };

async function session(request: Request) {
  try {
    return await getCurrentUser(request);
  } catch {
    return undefined;
  }
}

function fail(error: unknown, scope: string) {
  if (error instanceof SubscriptionError) return NextResponse.json({ error: error.code }, { status: statusOf[error.code] });
  console.error(`Subscription ${scope} failed`, error instanceof Error ? error.name : "unknown");
  return NextResponse.json({ error: "service" }, { status: 503 });
}

/** Return URL base: APP_URL in production (HTTPS), the request origin in development. */
function appUrl(request: Request) {
  const configured = process.env.APP_URL?.trim().replace(/\/$/, "");
  if (configured) return configured;
  return process.env.NODE_ENV === "production" ? "" : new URL(request.url).origin;
}

export async function GET(request: Request) {
  const current = await session(request);
  if (current === undefined) return NextResponse.json({ error: "service" }, { status: 503 });
  if (!current) return NextResponse.json({ error: "sign_in_required" }, { status: 401 });
  try {
    return withRefreshedSession(NextResponse.json({ subscription: await getCurrentSubscription(current.user.id) }), current.token);
  } catch (error) {
    return fail(error, "lookup");
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const current = await session(request);
  if (current === undefined) return NextResponse.json({ error: "service" }, { status: 503 });
  if (!current) return NextResponse.json({ error: "sign_in_required" }, { status: 401 });
  const base = appUrl(request);
  if (!isMercadoPagoConfigured() || !base) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  const body = await request.json().catch(() => null) as { planId?: unknown } | null;
  if (typeof body?.planId !== "string" || body.planId.length > 24) return NextResponse.json({ error: "invalid_plan" }, { status: 400 });
  try {
    return withRefreshedSession(NextResponse.json(await startCheckout(current.user, body.planId, base)), current.token);
  } catch (error) {
    return fail(error, "checkout");
  }
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const current = await session(request);
  if (current === undefined) return NextResponse.json({ error: "service" }, { status: 503 });
  if (!current) return NextResponse.json({ error: "sign_in_required" }, { status: 401 });
  try {
    await cancelUserSubscriptions(current.user.id);
    return withRefreshedSession(NextResponse.json({ ok: true }), current.token);
  } catch (error) {
    return fail(error, "cancel");
  }
}
