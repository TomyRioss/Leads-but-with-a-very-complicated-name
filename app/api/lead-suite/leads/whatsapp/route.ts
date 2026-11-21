import { NextResponse } from "next/server";
import { getCurrentUser, withRefreshedSession } from "@/lib/server/auth";
import { runBusinessSearch } from "@/lib/server/business-search";
import { errorTranslator, resolveLocale } from "@/lib/server/locale";
import { rateLimited } from "@/lib/server/rate-limit";
import { isWhatsAppCheckAvailable, WhatsAppNotConnectedError, WhatsAppUnavailableError } from "@/lib/server/whatsapp";
import { analyzeBatchWhatsApp, replaceNoWhatsApp } from "@/lib/server/whatsapp-check";
import { RECORD_ID } from "@/lib/server/leads";

export const maxDuration = 300;

/** POST { batchId, action: "check" | "replace" }: verify the batch's numbers on WhatsApp, or replace the ones without it for free. */
export async function POST(request: Request) {
  const startedAt = Date.now();
  const t = errorTranslator(request);
  let session: Awaited<ReturnType<typeof getCurrentUser>>;
  try {
    session = await getCurrentUser(request);
  } catch {
    return NextResponse.json({ error: t("accountService") }, { status: 503 });
  }
  if (!session) return NextResponse.json({ error: t("signInToViewLeads") }, { status: 401 });

  const body = await request.json().catch(() => null) as { batchId?: unknown; action?: unknown } | null;
  if (typeof body?.batchId !== "string" || !RECORD_ID.test(body.batchId) || (body.action !== "check" && body.action !== "replace")) {
    return NextResponse.json({ error: t("invalidRequestBody") }, { status: 400 });
  }
  if (rateLimited(`wa-check:${session.user.id}`, 6, 60_000)) return NextResponse.json({ error: t("generic") }, { status: 429 });
  // The staff session does the lookups: without it nothing runs (and a replacement never starts a paid-for search for nothing).
  if (!(await isWhatsAppCheckAvailable())) return NextResponse.json({ error: "whatsapp_check_unavailable" }, { status: 503 });

  try {
    if (body.action === "check") {
      const result = await analyzeBatchWhatsApp(session.user.id, body.batchId);
      if (!result) return NextResponse.json({ error: t("batchNotFound") }, { status: 404 });
      return withRefreshedSession(NextResponse.json(result), session.token);
    }
    const result = await replaceNoWhatsApp(session.user.id, body.batchId, (topUp) =>
      runBusinessSearch(session.user, { topUp }, { locale: resolveLocale(request), startedAt }));
    if ("error" in result) {
      if (result.error === "batch_not_found") return NextResponse.json({ error: t("batchNotFound") }, { status: 404 });
      if (result.error === "not_replaceable") return NextResponse.json({ error: "not_replaceable" }, { status: 400 });
      return NextResponse.json(result.body, { status: result.status });
    }
    return withRefreshedSession(NextResponse.json(result), session.token);
  } catch (error) {
    if (error instanceof WhatsAppNotConnectedError || error instanceof WhatsAppUnavailableError) {
      return NextResponse.json({ error: "whatsapp_check_unavailable" }, { status: 503 });
    }
    console.error("WhatsApp check failed:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: t("generic") }, { status: 502 });
  }
}
