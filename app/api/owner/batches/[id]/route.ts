import { NextResponse } from "next/server";
import { getOwnerSession } from "@/lib/server/owner";
import { recordOwnerAction } from "@/lib/server/owner-audit";
import { pocketBaseFetch } from "@/lib/server/pocketbase";
import { countRecords, errorResponse, filterString, findUserSummary, isNotFound, isValidRecordId, pocketBaseNotReady } from "../../_shared";

type BatchRecord = {
  id: string;
  user?: string;
  keywords?: unknown;
  country?: string;
  province?: string;
  district?: string;
  status?: string;
  created_at?: string;
};

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getOwnerSession(request);
  if ("response" in session) return session.response;
  const denied = pocketBaseNotReady();
  if (denied) return denied;
  const { id } = await context.params;
  if (!isValidRecordId(id)) return errorResponse("No encontramos ese lote.", 404);

  try {
    const batch = await pocketBaseFetch<BatchRecord>(`/api/collections/lead_batches/records/${id}`);
    // A search that is still running could keep writing leads (and charging credits) into the deleted batch.
    const startedAt = Date.parse(batch.created_at ?? "");
    if (batch.status === "running" && (!Number.isFinite(startedAt) || Date.now() - startedAt < 30 * 60 * 1000)) {
      return errorResponse("La búsqueda sigue en curso", 409);
    }
    const [deletedLeads, owner] = await Promise.all([
      countRecords("leads", `batch = ${filterString(id)}`),
      batch.user ? findUserSummary(batch.user).catch(() => null) : null,
    ]);
    // leads.batch cascades on delete, so removing the batch removes its leads.
    await pocketBaseFetch(`/api/collections/lead_batches/records/${id}`, { method: "DELETE" });

    const keywords = Array.isArray(batch.keywords) ? batch.keywords.map(String) : [];
    const zone = [batch.district, batch.province, batch.country].filter(Boolean).join(", ");
    await recordOwnerAction(request, session.owner, {
      action: "batch.delete",
      targetType: "batch",
      targetId: id,
      targetLabel: `${keywords.join(", ")}${zone ? ` · ${zone}` : ""}`,
      details: { ownerEmail: owner?.email ?? "", ownerId: batch.user ?? "", keywords, zone, status: batch.status ?? "", deletedLeads },
    });
    return NextResponse.json({ ok: true, deletedLeads });
  } catch (error) {
    if (isNotFound(error)) return errorResponse("No encontramos ese lote.", 404);
    console.error("Owner batch delete failed:", error instanceof Error ? error.name : "unknown");
    return errorResponse("No se pudo eliminar el lote.", 502);
  }
}
