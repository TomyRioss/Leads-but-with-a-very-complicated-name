import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/server/owner";
import { errorTranslator } from "@/lib/server/locale";
import { listTraceEvents, TRACE_MAX_PAGE, TRACE_TYPES, type TraceType } from "@/lib/server/owner-traceability";
import { errorResponse, pocketBaseNotReady } from "../_shared";

function parseDate(value: string | null, endOfDay: boolean) {
  if (!value) return null;
  // Plain dates (yyyy-mm-dd from <input type="date">) cover the whole day in UTC.
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z` : value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** GET ?user=<id|email>&types=a,b&from&to&page → owner timeline, newest first, 50 per page. */
export async function GET(request: Request) {
  const t = errorTranslator(request);
  const denied = (await requireOwner(request)) ?? pocketBaseNotReady(request);
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const requested = (params.get("types") ?? "").split(",").map((type) => type.trim()).filter(Boolean);
  if (requested.some((type) => !TRACE_TYPES.includes(type as TraceType))) return errorResponse(t("ownerInvalidData"), 400);
  const types = requested.length ? [...new Set(requested)] as TraceType[] : [...TRACE_TYPES];
  const from = parseDate(params.get("from"), false);
  const to = parseDate(params.get("to"), true);
  if (from === undefined || to === undefined || (from && to && from > to)) return errorResponse(t("ownerInvalidData"), 400);
  const page = Number.parseInt(params.get("page") ?? "1", 10);
  if (!Number.isInteger(page) || page < 1 || page > TRACE_MAX_PAGE) return errorResponse(t("invalidPage"), 400);

  try {
    const result = await listTraceEvents({ user: (params.get("user") ?? "").trim().slice(0, 100), types, from, to, page });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Owner traceability failed:", error instanceof Error ? error.name : "unknown");
    return errorResponse(t("generic"), 502);
  }
}
