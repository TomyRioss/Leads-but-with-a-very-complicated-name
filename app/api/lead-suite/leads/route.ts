import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server/auth";
import { listSidebarLeads, listUserLeads, searchMentionLeads, SIDEBAR_VIEWS, type SidebarView } from "@/lib/server/lead-suite";
import { PocketBaseRequestError } from "@/lib/server/pocketbase";
import { errorTranslator } from "@/lib/server/locale";
import { uiError } from "@/lib/server/public-error";
import { CONTACT_STATUSES, type LeadContactStatus } from "@/lib/lead-suite";

const STATUSES: readonly string[] = ["not_contacted", ...CONTACT_STATUSES];

export async function GET(request: Request) {
  const t = errorTranslator(request);
  let session: Awaited<ReturnType<typeof getCurrentUser>>;
  try {
    session = await getCurrentUser(request);
  } catch {
    return NextResponse.json({ error: t("accountService") }, { status: 503 });
  }
  if (!session) return NextResponse.json({ error: t("signInToContinue") }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const status = params.get("status");
  if (status && !STATUSES.includes(status)) return NextResponse.json({ error: t("generic") }, { status: 400 });
  const page = Number(params.get("page") ?? 1);

  try {
    // Chat @mentions: ranked by relevance, recent leads when the query is empty.
    if (params.get("mention") === "1") {
      const limit = Math.min(20, Math.max(1, Number(params.get("limit")) || 6));
      return NextResponse.json({ items: await searchMentionLeads(session.user.id, params.get("q") ?? "", limit) }, { headers: { "Cache-Control": "no-store" } });
    }
    // Leadtita sidebar tabs.
    const view = params.get("view");
    if (view !== null) {
      if (!(SIDEBAR_VIEWS as readonly string[]).includes(view)) return NextResponse.json({ error: t("generic") }, { status: 400 });
      return NextResponse.json({ items: await listSidebarLeads(session.user.id, view as SidebarView) }, { headers: { "Cache-Control": "no-store" } });
    }
    const result = await listUserLeads(session.user.id, {
      page: Number.isFinite(page) ? page : 1,
      perPage: 20,
      status: (status as LeadContactStatus | null) ?? undefined,
      query: params.get("q") ?? undefined,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const pb = error instanceof PocketBaseRequestError ? { status: error.status, operation: error.operation, detail: error.detail.slice(0, 500) } : null;
    const detail = pb ? `PocketBase ${pb.status}: ${pb.detail || (error as Error).message}` : error instanceof Error ? error.message : "unknown";
    console.error("Lead Suite leads failed:", error instanceof Error ? error.name : "unknown", pb ?? "");
    return NextResponse.json({ error: uiError(detail, t("generic")) }, { status: 502 });
  }
}
