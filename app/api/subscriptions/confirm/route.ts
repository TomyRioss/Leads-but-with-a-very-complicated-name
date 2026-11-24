import { NextResponse } from "next/server";
import { withRefreshedSession } from "@/lib/server/auth";
import { sameOrigin } from "@/lib/server/leadtita-conversations";
import { linkSubscription } from "@/lib/server/subscriptions";
import { fail, session } from "../_shared";

// Called by the browser when the Rebill widget reports success: links that subscription to the signed-in user.
// Credits are never granted here, only by the signed webhook.

const SUBSCRIPTION_ID = /^[A-Za-z0-9_-]{1,64}$/;

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const current = await session(request);
  if (current === undefined) return NextResponse.json({ error: "service" }, { status: 503 });
  if (!current) return NextResponse.json({ error: "sign_in_required" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { subscriptionId?: unknown };
  if (typeof body.subscriptionId !== "string" || !SUBSCRIPTION_ID.test(body.subscriptionId)) return NextResponse.json({ error: "invalid_subscription" }, { status: 400 });
  try {
    await linkSubscription(current.user, body.subscriptionId);
    return withRefreshedSession(NextResponse.json({ ok: true }), current.token);
  } catch (error) {
    return fail(error, "confirm");
  }
}
