import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/server/owner";
import { errorResponse, filterString, listRecords, pocketBaseNotReady } from "../_shared";

// Values of the lead_batches.status select (pb_migrations/1762471200_create_lead_collections.js).
const statuses = ["running", "completed", "partial", "failed"];
type Row = {
  id: string;
  user?: string;
  keywords: unknown;
  country: string;
  province?: string;
  district?: string;
  requested_count: number;
  result_count?: number;
  status: string;
  created_at: string;
  expand?: { user?: { id: string; email: string } };
};

function positiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.min(parsed, max) : fallback;
}

function keywordsText(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item)).join(", ");
  return typeof value === "string" ? value : "";
}

export async function GET(request: Request) {
  const denied = (await requireOwner(request)) ?? pocketBaseNotReady();
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const status = params.get("status") ?? "";
  if (status && !statuses.includes(status)) return errorResponse("El estado no es válido.", 400);
  const q = (params.get("q") ?? "").trim().slice(0, 100);
  const filters = [status && `status = ${filterString(status)}`, q && `user.email ~ ${filterString(q)}`].filter(Boolean);

  try {
    const result = await listRecords<Row>("lead_batches", {
      page: positiveInt(params.get("page"), 1, 100_000),
      perPage: positiveInt(params.get("perPage"), 25, 100),
      // lead_batches has no `created` autodate: created_at is the date field.
      sort: "-created_at",
      expand: "user",
      fields: "id,user,keywords,country,province,district,requested_count,result_count,status,created_at,expand.user.id,expand.user.email",
      ...(filters.length ? { filter: filters.join(" && ") } : {}),
    });
    return NextResponse.json({
      items: result.items.map((item) => ({
        id: item.id,
        userId: item.user ?? "",
        userEmail: item.expand?.user?.email ?? "",
        keywords: keywordsText(item.keywords),
        country: item.country,
        province: item.province ?? "",
        district: item.district ?? "",
        requestedCount: item.requested_count,
        resultCount: item.result_count ?? 0,
        status: item.status,
        createdAt: item.created_at,
      })),
      page: result.page,
      totalPages: result.totalPages,
      totalItems: result.totalItems,
    });
  } catch (error) {
    console.error("Owner batches list failed:", error instanceof Error ? error.name : "unknown");
    return errorResponse("No se pudieron cargar las búsquedas.", 502);
  }
}
