import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server/auth";
import { getLatestWeeklyReport, getLeadSuiteMetrics, listLeadContacts } from "@/lib/server/lead-suite";
import { PocketBaseRequestError } from "@/lib/server/pocketbase";
import { errorTranslator } from "@/lib/server/locale";
import { uiError } from "@/lib/server/public-error";

const dayMs = 86_400_000;
const maxRangeMs = 366 * dayMs;

function parseDate(value: string | null) {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : NaN;
}

/** Rango validado: default últimos 30 días; `from` <= `to` y como máximo un año. */
function resolveRange(url: URL) {
  const to = parseDate(url.searchParams.get("to")) ?? Date.now();
  const from = parseDate(url.searchParams.get("from")) ?? to - 30 * dayMs;
  if (Number.isNaN(to) || Number.isNaN(from) || from > to || to - from > maxRangeMs) return null;
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
}

export async function GET(request: Request) {
  const t = errorTranslator(request);
  let session: Awaited<ReturnType<typeof getCurrentUser>>;
  try {
    session = await getCurrentUser(request);
  } catch {
    return NextResponse.json({ error: t("accountService") }, { status: 503 });
  }
  if (!session) return NextResponse.json({ error: t("signInToContinue") }, { status: 401 });

  const range = resolveRange(new URL(request.url));
  if (!range) return NextResponse.json({ error: t("generic") }, { status: 400 });

  const userId = session.user.id;
  try {
    const [metrics, recent, latestReport] = await Promise.all([
      getLeadSuiteMetrics(userId, range),
      listLeadContacts(userId, { page: 1, perPage: 10 }),
      getLatestWeeklyReport(userId),
    ]);
    return NextResponse.json({ metrics, recentContacts: recent.items, latestReport }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    // status/detail de PocketBase (mensaje de validación, sin token ni datos del usuario) para diagnosticar colecciones o campos faltantes.
    const pb = error instanceof PocketBaseRequestError ? { status: error.status, operation: error.operation, detail: error.detail.slice(0, 500) } : null;
    const detail = pb ? `PocketBase ${pb.status}: ${pb.detail || (error as Error).message}` : error instanceof Error ? error.message : "unknown";
    console.error("Lead Suite dashboard failed:", error instanceof Error ? error.name : "unknown", pb ?? "");
    return NextResponse.json({ error: uiError(detail, t("generic")) }, { status: 502 });
  }
}
