import { NextResponse } from "next/server";
import { withRefreshedSession } from "@/lib/server/auth";
import { sameOrigin } from "@/lib/server/leadtita-conversations";
import { cancelUserSubscriptions, getCurrentSubscription, startCheckout } from "@/lib/server/subscriptions";
import { fail, session } from "./_shared";

// The session user's paid plan: GET current, POST starts a checkout (returns what the Rebill widget needs), DELETE cancels it.

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
  const body = await request.json().catch(() => ({})) as { planId?: unknown };
  try {
    return withRefreshedSession(NextResponse.json(await startCheckout(current.user, typeof body.planId === "string" ? body.planId : "")), current.token);
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
