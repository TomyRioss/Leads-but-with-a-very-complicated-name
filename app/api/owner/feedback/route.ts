import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/server/owner";
import { isLinearConfigured, listFeedbackIssues, type FeedbackIssue } from "@/lib/server/linear";
import { errorTranslator } from "@/lib/server/locale";
import { errorResponse, parseSortParam } from "../_shared";

function positiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.min(parsed, max) : fallback;
}

const text = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
// Whitelisted sorts, applied in memory over the full filtered set (listFeedbackIssues already loads it newest first).
const sorters = {
  createdAt: (a: FeedbackIssue, b: FeedbackIssue) => a.createdAt.localeCompare(b.createdAt),
  user: (a: FeedbackIssue, b: FeedbackIssue) => text(a.user?.email ?? "", b.user?.email ?? ""),
  kind: (a: FeedbackIssue, b: FeedbackIssue) => a.kind.localeCompare(b.kind),
  state: (a: FeedbackIssue, b: FeedbackIssue) => a.state.localeCompare(b.state),
  identifier: (a: FeedbackIssue, b: FeedbackIssue) => text(a.identifier, b.identifier),
};
const sortKeys = Object.keys(sorters) as (keyof typeof sorters)[];

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
  const sort = parseSortParam(params.get("sort"), sortKeys);

  try {
    const filtered = (await listFeedbackIssues()).filter((item) =>
      (status !== "open" && status !== "closed" || item.state === status)
      && (!q || item.user?.email.toLowerCase().includes(q) || item.message.toLowerCase().includes(q) || item.identifier.toLowerCase().includes(q)));
    // Stable sort: ties keep the newest-first order of the source list.
    if (sort) filtered.sort((a, b) => (sort.desc ? -1 : 1) * sorters[sort.key](a, b));
    const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
    const page = Math.min(positiveInt(params.get("page"), 1, 100_000), totalPages);
    return NextResponse.json({ items: filtered.slice((page - 1) * perPage, page * perPage), page, totalPages, totalItems: filtered.length });
  } catch (error) {
    console.error("Owner feedback list failed:", error instanceof Error ? error.message.slice(0, 200) : "unknown");
    return errorResponse(t("ownerFeedbackLoadFailed"), 502);
  }
}
