import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/server/owner";
import { ownerAuditActions } from "@/lib/server/owner-audit";
import { errorResponse, filterString, isNotFound, listRecords, pocketBaseNotReady } from "../_shared";

type AuditRecord = {
  id: string;
  actor_email: string;
  action: string;
  target_type: string;
  target_id: string;
  target_label: string;
  details: unknown;
  ip: string;
  created: string;
};

function positiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.min(parsed, max) : fallback;
}

export async function GET(request: Request) {
  const denied = (await requireOwner(request)) ?? pocketBaseNotReady();
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const action = params.get("action")?.trim() ?? "";
  if (action && !(ownerAuditActions as readonly string[]).includes(action)) return errorResponse("La acción no es válida.", 400);
  const q = (params.get("q") ?? "").trim().slice(0, 100);

  const filters: string[] = [];
  if (action) filters.push(`action = ${filterString(action)}`);
  if (q) filters.push(`(target_label ~ ${filterString(q)} || actor_email ~ ${filterString(q)})`);

  try {
    const result = await listRecords<AuditRecord>("owner_audit_log", {
      page: positiveInt(params.get("page"), 1, 100_000),
      perPage: positiveInt(params.get("perPage"), 25, 100),
      sort: "-created",
      ...(filters.length ? { filter: filters.join(" && ") } : {}),
    });
    return NextResponse.json({
      items: result.items.map((entry) => ({
        id: entry.id,
        actorEmail: entry.actor_email,
        action: entry.action,
        targetType: entry.target_type,
        targetId: entry.target_id,
        targetLabel: entry.target_label,
        details: entry.details ?? {},
        ip: entry.ip,
        created: entry.created,
      })),
      page: result.page,
      totalPages: result.totalPages,
      totalItems: result.totalItems,
    });
  } catch (error) {
    if (isNotFound(error)) return errorResponse("La auditoría no está inicializada.", 503);
    console.error("Owner audit list failed:", error instanceof Error ? error.name : "unknown");
    return errorResponse("No se pudo cargar la auditoría.", 502);
  }
}
