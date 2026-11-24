import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server/auth";
import { SubscriptionError } from "@/lib/server/subscriptions";

// Shared by the subscription routes. Errors are codes ({ error }); the client translates them.

const STATUS: Record<SubscriptionError["code"], number> = {
  invalid_plan: 400,
  already_subscribed: 409,
  not_configured: 503,
  not_found: 404,
  invalid_subscription: 400,
  forbidden: 403,
  rebill: 502,
};

/** The signed-in user, null when signed out, undefined when the session service failed. */
export async function session(request: Request) {
  try {
    return await getCurrentUser(request);
  } catch {
    return undefined;
  }
}

export function fail(error: unknown, scope: string) {
  if (error instanceof SubscriptionError) return NextResponse.json({ error: error.code }, { status: STATUS[error.code] });
  console.error(`Subscription ${scope} failed`, error instanceof Error ? error.name : "unknown");
  return NextResponse.json({ error: "service" }, { status: 503 });
}
