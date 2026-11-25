import { NextResponse } from "next/server";
import { withRefreshedSession } from "@/lib/server/auth";
import { confirmSubscription } from "@/lib/server/subscriptions";
import { session } from "../_shared";

// back_url of the Mercado Pago checkout: MP redirects the payer here with ?preapproval_id=…. The preapproval is read
// back from Mercado Pago and its status stored on the user's row. Credits are never granted here, only by the signed webhook.

const PREAPPROVAL_ID = /^[A-Za-z0-9_-]{1,64}$/;

export async function GET(request: Request) {
  const to = (path: string) => NextResponse.redirect(new URL(path, request.url), 303);
  const preapprovalId = new URL(request.url).searchParams.get("preapproval_id") ?? "";
  const current = await session(request);
  if (!current) return to(current === null ? "/login" : "/pricing");
  if (!PREAPPROVAL_ID.test(preapprovalId)) return to("/pricing");
  try {
    const status = await confirmSubscription(current.user, preapprovalId);
    return withRefreshedSession(to(status === "canceled" ? "/pricing" : "/leadtita"), current.token);
  } catch (error) {
    console.error("Subscription confirm failed", error instanceof Error ? error.name : "unknown");
    return to("/pricing");
  }
}
