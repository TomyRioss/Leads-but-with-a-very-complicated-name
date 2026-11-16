import { NextResponse } from "next/server";
import { dispatchDue } from "@/lib/server/scheduled-messages";
import { isWorkerRequest } from "@/lib/server/whatsapp";

export const maxDuration = 300;
// Leave room to finish the row in flight (Gmail send ~10 s) before the route limit.
const BUDGET_MS = 240_000;

/** Called every minute by the WhatsApp worker (shared secret): sends the scheduled messages that are due. */
export async function POST(request: Request) {
  if (!isWorkerRequest(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await dispatchDue(Date.now() + BUDGET_MS));
  } catch (error) {
    console.error("Scheduled dispatch failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "dispatch_failed" }, { status: 500 });
  }
}
