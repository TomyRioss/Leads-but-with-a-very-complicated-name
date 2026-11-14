import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/server/owner";
import { isLinearConfigured, listFeedbackIssues } from "@/lib/server/linear";
import { errorTranslator } from "@/lib/server/locale";
import { errorResponse } from "../_shared";

function positiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.min(parsed, max) : fallback;
}

/** Comentarios de usuarios leídos de Linear, filtrados y paginados en memoria (son pocos: ver listLimit). */
export async function GET(request: Request) {
  const t = errorTranslator(request);
  const denied = await requireOwner(request);
  if (denied) return denied;
  if (!isLinearConfigured()) return errorResponse(t("linearNotConfigured"), 503);

  const params = new URL(request.url).searchParams;
  const status = params.get("status");
  const q = (params.get("q") ?? "").trim().toLowerCase().slice(0, 100);
  const perPage = positiveInt(params.get("perPage"), 25, 100);

  try {
    const filtered = (await listFeedbackIssues()).filter((item) =>
      (status !== "open" && status !== "closed" || item.state === status)
      && (!q || item.user?.email.toLowerCase().includes(q) || item.message.toLowerCase().includes(q) || item.identifier.toLowerCase().includes(q)));
    const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
    const page = Math.min(positiveInt(params.get("page"), 1, 100_000), totalPages);
    return NextResponse.json({ items: filtered.slice((page - 1) * perPage, page * perPage), page, totalPages, totalItems: filtered.length });
  } catch (error) {
    console.error("Owner feedback list failed:", error instanceof Error ? error.message.slice(0, 200) : "unknown");
    return errorResponse(t("ownerFeedbackLoadFailed"), 502);
  }
}
