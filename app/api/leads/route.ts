import { connection, NextResponse } from "next/server";
import { getCurrentUser, withRefreshedSession } from "@/lib/server/auth";
import { isPocketBaseConfigured, pocketBaseFetch } from "@/lib/server/pocketbase";
import { uiError } from "@/lib/server/public-error";
import type { Lead } from "@/lib/types";
import { errorTranslator } from "@/lib/server/locale";
import { deleteBatchLeads, MAX_DELETE_LEADS, RECORD_ID } from "@/lib/server/leads";

export async function DELETE(request: Request) {
  const t = errorTranslator(request);
  let session: Awaited<ReturnType<typeof getCurrentUser>>;
  try {
    session = await getCurrentUser(request);
  } catch {
    return NextResponse.json({ error: t("accountService") }, { status: 503 });
  }
  if (!session) return NextResponse.json({ error: t("signInToViewLeads") }, { status: 401 });
  if (!isPocketBaseConfigured()) {
    return NextResponse.json({ error: uiError(t("pocketbaseNotConfigured"), t("generic")) }, { status: 503 });
  }

  const body = await request.json().catch(() => null) as { batchId?: unknown; leadIds?: unknown } | null;
  const batchId = body?.batchId;
  const leadIds = Array.isArray(body?.leadIds) ? [...new Set(body.leadIds)] : null;
  if (
    typeof batchId !== "string" || !RECORD_ID.test(batchId) ||
    !leadIds || leadIds.length < 1 || leadIds.length > MAX_DELETE_LEADS ||
    !leadIds.every((id): id is string => typeof id === "string" && RECORD_ID.test(id))
  ) {
    return NextResponse.json({ error: t("invalidRequestBody") }, { status: 400 });
  }

  try {
    const result = await deleteBatchLeads(session.user.id, batchId, leadIds);
    if ("error" in result) return NextResponse.json({ error: t("batchNotFound") }, { status: 404 });
    return withRefreshedSession(NextResponse.json(result), session.token);
  } catch (error) {
    console.error("PocketBase lead delete failed:", error);
    return NextResponse.json({ error: t("leadsLoadFailed") }, { status: 503 });
  }
}

export async function GET(request: Request) {
  const t = errorTranslator(request);
  await connection();
  let session: Awaited<ReturnType<typeof getCurrentUser>>;
  try {
    session = await getCurrentUser(request);
  } catch {
    return NextResponse.json({ error: t("accountService") }, { status: 503 });
  }
  if (!session) return NextResponse.json({ error: t("signInToViewLeads") }, { status: 401 });
  if (!isPocketBaseConfigured()) {
    return NextResponse.json({ error: uiError(t("pocketbaseNotConfigured"), t("generic")) }, { status: 503 });
  }

  const batchId = new URL(request.url).searchParams.get("batchId");
  if (!batchId || !/^[a-zA-Z0-9]{15}$/.test(batchId)) {
    return NextResponse.json({ error: t("selectValidBatch") }, { status: 400 });
  }

  try {
    const batchFilter = encodeURIComponent(`id = "${batchId}" && user = "${session.user.id}"`);
    const ownedBatch = await pocketBaseFetch<{ items: { id: string }[] }>(
      `/api/collections/lead_batches/records?perPage=1&filter=${batchFilter}`,
    );
    if (!ownedBatch.items.length) return NextResponse.json({ error: t("batchNotFound") }, { status: 404 });

    const filter = encodeURIComponent(`batch = "${batchId}"`);
    const response = await pocketBaseFetch<{ items: Lead[] }>(
      `/api/collections/leads/records?perPage=100&sort=created_at&filter=${filter}`,
    );
    return withRefreshedSession(NextResponse.json({ leads: response.items }), session.token);
  } catch (error) {
    console.error("PocketBase lead list failed:", error);
    return NextResponse.json({ error: t("leadsLoadFailed") }, { status: 503 });
  }
}
