import { CONTACT_CHANNELS, LEAD_SUITE_TIMEZONE, type LeadSuiteMetrics, type WeeklyReport } from "@/lib/lead-suite";
import { sendLeadSuiteWeeklyReport } from "@/lib/server/email";
import { getLatestWeeklyReport, getLeadSuiteMetrics, listWeeklyReportUsers, saveWeeklyReport } from "@/lib/server/lead-suite";
import type { Locale } from "@/lib/server/locale";
import { recordAiUsage } from "@/lib/server/ai-usage";

const model = "deepseek/deepseek-v4.1-flash";
const concurrency = 3;
const dayMs = 86_400_000;

type ReportUser = { id: string; email: string; name: string; locale: string };
export type WeeklyRunResult = { processed: number; sent: number; skipped: number; failed: number; stoppedEarly: boolean };

/** Semana anterior (lunes 00:00 UTC a domingo 23:59:59.999 UTC) respecto de `now`, y la previa. */
export function previousWeeks(now: Date) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const thisMonday = today - ((now.getUTCDay() + 6) % 7) * dayMs;
  const range = (start: number) => ({ from: new Date(start).toISOString(), to: new Date(start + 7 * dayMs - 1).toISOString() });
  return { current: range(thisMonday - 7 * dayMs), previous: range(thisMonday - 14 * dayMs) };
}

const toLocale = (value: string): Locale => (value === "en" ? "en" : "es");

/** Solo agregados: el modelo nunca ve mensajes ni datos de contacto de los leads. */
function metricsDigest(current: LeadSuiteMetrics, previous: LeadSuiteMetrics) {
  const topHours = current.byHour.map((count, hour) => ({ hour, count })).filter((h) => h.count > 0).sort((a, b) => b.count - a.count).slice(0, 3);
  return {
    contactsThisWeek: current.contactsInRange,
    contactsPreviousWeek: previous.contactsInRange,
    leadsContactedThisWeek: current.leadsContactedInRange,
    leadsContactedPreviousWeek: previous.leadsContactedInRange,
    totalContactedLeads: current.totalContactedLeads,
    replyRate: Math.round(current.replyRate * 100),
    byChannel: current.byChannel,
    byStatus: current.byStatus,
    topCategories: current.byCategory.slice(0, 5),
    topHoursLocal: topHours,
    pendingFollowUps: current.pendingFollowUps.length,
  };
}

function fallbackReport(current: LeadSuiteMetrics, previous: LeadSuiteMetrics, locale: Locale) {
  const es = locale === "es";
  const delta = current.contactsInRange - previous.contactsInRange;
  const bestChannel = CONTACT_CHANNELS.map((c) => ({ c, n: current.byChannel[c] ?? 0 })).sort((a, b) => b.n - a.n)[0];
  const summary = es
    ? `Esta semana registraste ${current.contactsInRange} contactos a ${current.leadsContactedInRange} leads (${delta >= 0 ? "+" : ""}${delta} vs. la semana previa). Tasa de respuesta: ${Math.round(current.replyRate * 100)}%.`
    : `This week you logged ${current.contactsInRange} contacts with ${current.leadsContactedInRange} leads (${delta >= 0 ? "+" : ""}${delta} vs. the previous week). Reply rate: ${Math.round(current.replyRate * 100)}%.`;
  const suggestions: string[] = [];
  if (current.pendingFollowUps.length) suggestions.push(es ? `Hacé seguimiento a ${current.pendingFollowUps.length} leads que no respondieron en más de 3 días.` : `Follow up with ${current.pendingFollowUps.length} leads who haven't replied in over 3 days.`);
  if (bestChannel && bestChannel.n > 0) suggestions.push(es ? `Tu canal más usado fue ${bestChannel.c}; compará su respuesta con otros canales.` : `Your most used channel was ${bestChannel.c}; compare its replies with other channels.`);
  if (current.byCategory[0]) suggestions.push(es ? `El rubro con más contactos fue ${current.byCategory[0].category}.` : `The category with the most contacts was ${current.byCategory[0].category}.`);
  if (delta < 0) suggestions.push(es ? "Contactaste menos que la semana previa: reservá un bloque fijo de prospección." : "You contacted fewer leads than last week: block a fixed prospecting slot.");
  if (!suggestions.length) suggestions.push(es ? "Registrá cada contacto para obtener sugerencias más precisas." : "Log every contact to get more precise suggestions.");
  return { summary, suggestions };
}

/** Valida la salida del modelo; null si no cumple el formato. */
export function parseModelReport(content: unknown): { summary: string; suggestions: string[] } | null {
  if (typeof content !== "string") return null;
  try {
    const data = JSON.parse(content) as { summary?: unknown; suggestions?: unknown };
    if (typeof data.summary !== "string" || !data.summary.trim() || !Array.isArray(data.suggestions)) return null;
    const suggestions = data.suggestions.filter((s): s is string => typeof s === "string" && s.trim().length > 0).map((s) => s.trim().slice(0, 300)).slice(0, 5);
    if (suggestions.length < 3) return null;
    return { summary: data.summary.trim().slice(0, 800), suggestions };
  } catch {
    return null;
  }
}

async function modelReport(digest: ReturnType<typeof metricsDigest>, locale: Locale, userId?: string) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: { summary: { type: "string" }, suggestions: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 5 } },
    required: ["summary", "suggestions"],
  };
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        provider: { require_parameters: true, sort: "price" },
        response_format: { type: "json_schema", json_schema: { name: "lead_suite_weekly_report", strict: true, schema } },
        plugins: [{ id: "response-healing" }],
        messages: [
          {
            role: "system",
            content: `You write a weekly sales prospecting report in ${locale === "es" ? "Spanish (Rioplatense, voseo)" : "English"}. Use ONLY the JSON metrics given. Return a brief summary (max 3 sentences) comparing with the previous week, and 3-5 concrete, actionable suggestions about channels with better replies, best hours (local time, ${LEAD_SUITE_TIMEZONE}), pending follow-ups and categories. Never invent numbers.`,
          },
          { role: "user", content: JSON.stringify(digest) },
        ],
        max_tokens: 800,
        temperature: 0.3,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) return null;
    const payload = await response.json() as { choices?: { message?: { content?: unknown } }[]; usage?: unknown };
    void recordAiUsage({ feature: "lead_suite_report", model, userId, usage: payload.usage });
    return parseModelReport(payload.choices?.[0]?.message?.content);
  } catch {
    return null;
  }
}

async function processUser(user: ReportUser, weeks: ReturnType<typeof previousWeeks>): Promise<"sent" | "skipped"> {
  const weekStart = weeks.current.from;
  const latest = await getLatestWeeklyReport(user.id);
  if (latest?.sentAt && latest.weekStart.slice(0, 10) === weekStart.slice(0, 10)) return "skipped";

  const locale = toLocale(user.locale);
  const [current, previous] = await Promise.all([getLeadSuiteMetrics(user.id, weeks.current), getLeadSuiteMetrics(user.id, weeks.previous)]);
  if (current.contactsInRange === 0 && previous.contactsInRange === 0) return "skipped";

  const content = (await modelReport(metricsDigest(current, previous), locale, user.id)) ?? fallbackReport(current, previous, locale);
  const report: WeeklyReport = { weekStart, summary: content.summary, suggestions: content.suggestions, metrics: current, sentAt: null };
  await saveWeeklyReport(user.id, report);
  // La Idempotency-Key de Resend (user + semana) evita duplicados si falla el guardado posterior.
  await sendLeadSuiteWeeklyReport({ userId: user.id, to: user.email, name: user.name, locale, report });
  await saveWeeklyReport(user.id, { ...report, sentAt: new Date().toISOString() });
  return "sent";
}

/** Genera, guarda y envía los reportes de la semana anterior. Se detiene antes de `deadline` (ms epoch). */
export async function runWeeklyReports(now: Date, deadline: number): Promise<WeeklyRunResult> {
  const weeks = previousWeeks(now);
  const result: WeeklyRunResult = { processed: 0, sent: 0, skipped: 0, failed: 0, stoppedEarly: false };
  for (let page = 1; ; page += 1) {
    const { items, totalPages } = await listWeeklyReportUsers(page);
    for (let i = 0; i < items.length; i += concurrency) {
      if (Date.now() > deadline) return { ...result, stoppedEarly: true };
      const outcomes = await Promise.allSettled(items.slice(i, i + concurrency).map((user) => processUser(user, weeks)));
      for (const outcome of outcomes) {
        result.processed += 1;
        if (outcome.status === "rejected") {
          result.failed += 1;
          console.error("[lead-suite-report]", outcome.reason instanceof Error ? outcome.reason.message : outcome.reason);
        } else result[outcome.value] += 1;
      }
    }
    if (page >= totalPages || !items.length) return result;
  }
}
