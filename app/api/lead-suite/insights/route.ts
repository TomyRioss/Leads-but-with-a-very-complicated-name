import { NextResponse } from "next/server";
import { cacheLife } from "next/cache";
import { getCurrentUser } from "@/lib/server/auth";
import { listLeadContacts, listLeadDirectory } from "@/lib/server/lead-suite";
import {
  computeInsightMetrics,
  fallbackAnalysis,
  isValidTimeZone,
  localParts,
  MIN_CONTACTS_FOR_ANALYSIS,
  requestDailyAnalysis,
  type DailyAnalysis,
  type InsightLocale,
} from "@/lib/server/lead-suite-insights";
import { PocketBaseRequestError } from "@/lib/server/pocketbase";
import { errorTranslator, localeFrom } from "@/lib/server/locale";
import { uiError } from "@/lib/server/public-error";
import type { LeadContact } from "@/lib/lead-suite";

const DAY_MS = 86_400_000;
const MAX_RANGE_MS = 92 * DAY_MS;
const ANALYSIS_WINDOW_DAYS = 30;
const MAX_CONTACT_PAGES = 20;
const MAX_REFRESHES_PER_DAY = 2;

// ponytail: contador en memoria por instancia; si hace falta un límite estricto entre instancias, moverlo a la base.
const refreshSlots = new Map<string, number>();

/** Contactos del usuario en [from, to], paginados (100 por página, como máximo 2000). */
async function loadContacts(userId: string, from: string, to: string): Promise<LeadContact[]> {
  const first = await listLeadContacts(userId, { from, to, page: 1, perPage: 100 });
  const pages = Math.min(first.totalPages, MAX_CONTACT_PAGES);
  const rest = await Promise.all(Array.from({ length: Math.max(0, pages - 1) }, (_, index) => listLeadContacts(userId, { from, to, page: index + 2, perPage: 100 })));
  return [first, ...rest].flatMap((page) => page.items);
}

/**
 * Análisis diario de Leadtita. Cacheado por usuario, día local, idioma, zona horaria y slot de "Actualizar"
 * (todos son argumentos, así que forman parte de la clave y nunca se comparte entre usuarios).
 */
async function dailyAnalysis(userId: string, day: string, locale: InsightLocale, timeZone: string, slot: number): Promise<DailyAnalysis> {
  "use cache";
  void day;
  void slot;
  const now = new Date();
  const to = now.toISOString();
  const from = new Date(now.getTime() - ANALYSIS_WINDOW_DAYS * DAY_MS).toISOString();
  const previousFrom = new Date(now.getTime() - 2 * ANALYSIS_WINDOW_DAYS * DAY_MS).toISOString();
  const [contacts, leads] = await Promise.all([loadContacts(userId, previousFrom, to), listLeadDirectory(userId)]);
  const metrics = computeInsightMetrics(contacts, leads, { from, to, timeZone, now });
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (metrics.totalContacts < MIN_CONTACTS_FOR_ANALYSIS || !apiKey) {
    cacheLife("hours");
    return fallbackAnalysis(metrics, locale, now);
  }
  try {
    const analysis = await requestDailyAnalysis(apiKey, metrics, locale, now, userId);
    cacheLife("days");
    return analysis;
  } catch (error) {
    // Un fallo del modelo no se fija por todo el día: el fallback dura minutos y se reintenta.
    console.error("Lead Suite insights model failed:", error instanceof Error ? error.message.slice(0, 200) : "unknown");
    cacheLife("minutes");
    return fallbackAnalysis(metrics, locale, now);
  }
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

  const params = new URL(request.url).searchParams;
  const toMs = Date.parse(params.get("to") ?? "") || Date.now();
  const fromMs = Date.parse(params.get("from") ?? "") || toMs - 30 * DAY_MS;
  const timeZone = params.get("tz") ?? "UTC";
  if (fromMs > toMs || toMs - fromMs > MAX_RANGE_MS || !isValidTimeZone(timeZone)) return NextResponse.json({ error: t("generic") }, { status: 400 });
  const locale: InsightLocale = localeFrom(request, params.get("locale")) === "en" ? "en" : "es";

  const userId = session.user.id;
  const day = localParts(new Date().toISOString(), timeZone).date;
  const slotKey = `${userId}:${day}`;
  let slot = refreshSlots.get(slotKey) ?? 0;
  if (params.get("refresh") === "1" && slot < MAX_REFRESHES_PER_DAY) {
    slot += 1;
    refreshSlots.set(slotKey, slot);
  }

  try {
    const from = new Date(fromMs).toISOString();
    const to = new Date(toMs).toISOString();
    const previousFrom = new Date(fromMs - (toMs - fromMs)).toISOString();
    const [contacts, leads, analysis] = await Promise.all([
      loadContacts(userId, previousFrom, to),
      listLeadDirectory(userId),
      dailyAnalysis(userId, day, locale, timeZone, slot),
    ]);
    const metrics = computeInsightMetrics(contacts, leads, { from, to, timeZone });
    return NextResponse.json(
      { metrics, analysis, refreshesLeft: MAX_REFRESHES_PER_DAY - slot },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const pb = error instanceof PocketBaseRequestError ? { status: error.status, operation: error.operation, detail: error.detail.slice(0, 500) } : null;
    const detail = pb ? `PocketBase ${pb.status}: ${pb.detail || (error as Error).message}` : error instanceof Error ? error.message : "unknown";
    console.error("Lead Suite insights failed:", error instanceof Error ? error.name : "unknown", pb ?? "");
    return NextResponse.json({ error: uiError(detail, t("generic")) }, { status: 502 });
  }
}
