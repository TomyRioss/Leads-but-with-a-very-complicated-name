// Métricas extra de Lead Suite y análisis diario de Leadtita.
// Solo imports de tipos: el cálculo es puro y se prueba con lead-suite-insights.selfcheck.mjs (node --experimental-strip-types).
import type { ContactChannel, ContactStatus, LeadContact, LeadMatch } from "../lead-suite";
import { recordAiUsage } from "@/lib/server/ai-usage";

const REPLY_STATUSES: ReadonlySet<string> = new Set(["replied", "meeting", "won"]);
const CHANNELS: ContactChannel[] = ["whatsapp", "email", "phone", "instagram", "linkedin", "in_person", "other"];
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const OVERDUE_DAYS = 3;
const MIN_SAMPLE = 2;

export type FunnelStage = "contacted" | "replied" | "meeting" | "won";
export type Delta = { value: number | null; previous: number | null };
export interface ChannelStat { channel: ContactChannel; sent: number; leads: number; replied: number; replyRate: number }
export interface GroupStat { name: string; leads: number; replied: number; replyRate: number }
export interface OverdueLead { id: string; name: string; category: string; lastContactedAt: string; days: number }
export interface InsightMetrics {
  range: { from: string; to: string };
  timeZone: string;
  totalContacts: number;
  kpis: {
    contacts: Delta;
    replyRate: Delta;
    avgReplyHours: Delta;
    bestChannel: { channel: ContactChannel; replyRate: number; leads: number } | null;
    bestHour: { hour: number; replyRate: number; leads: number } | null;
    overdue: number;
  };
  trendUnit: "day" | "week";
  trend: { date: string; sent: number; replies: number }[];
  funnel: { stage: FunnelStage; count: number; rateFromPrev: number | null }[];
  channels: ChannelStat[];
  /** 7 × 24 (lunes = 0), hora local: registros enviados y registros de respuesta. */
  heat: { sent: number[][]; replies: number[][] };
  categories: GroupStat[];
  cities: GroupStat[];
  overdue: OverdueLead[];
}

type LocalParts = { date: string; weekday: number; hour: number };
const formatters = new Map<string, Intl.DateTimeFormat>();

export function isValidTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Fecha (YYYY-MM-DD), día de semana (lunes = 0) y hora en la zona del usuario. */
export function localParts(iso: string, timeZone: string): LocalParts {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short" });
    formatters.set(timeZone, format);
  }
  const parts = Object.fromEntries(format.formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.weekday);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, weekday, hour: Number(parts.hour) % 24 };
}

function addDays(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function mondayOf(date: string) {
  const day = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(date, -day);
}

const isReply = (status: ContactStatus | string) => REPLY_STATUSES.has(status);
const ratio = (part: number, total: number) => (total > 0 ? part / total : 0);
const grid = () => Array.from({ length: 7 }, () => Array<number>(24).fill(0));

type PeriodStats = { contacts: number; leads: Map<string, LeadContact[]>; replyRate: number | null; avgReplyHours: number | null };

/** Agrupa por lead y calcula tasa de respuesta y tiempo medio hasta respuesta del período. */
function periodStats(contacts: LeadContact[], leadsById: Map<string, LeadMatch>): PeriodStats {
  const leads = new Map<string, LeadContact[]>();
  for (const contact of contacts) {
    const list = leads.get(contact.leadId);
    if (list) list.push(contact);
    else leads.set(contact.leadId, [contact]);
  }
  let replied = 0;
  const replyHours: number[] = [];
  for (const [leadId, list] of leads) {
    list.sort((a, b) => a.contactedAt.localeCompare(b.contactedAt));
    if (leadReplied(leadId, list, leadsById)) replied++;
    const first = list.find((contact) => !isReply(contact.status));
    const reply = first && list.find((contact) => isReply(contact.status) && contact.contactedAt > first.contactedAt);
    if (first && reply) replyHours.push((Date.parse(reply.contactedAt) - Date.parse(first.contactedAt)) / HOUR_MS);
  }
  return {
    contacts: contacts.length,
    leads,
    replyRate: leads.size ? replied / leads.size : null,
    avgReplyHours: replyHours.length ? replyHours.reduce((sum, value) => sum + value, 0) / replyHours.length : null,
  };
}

function leadReplied(leadId: string, list: LeadContact[], leadsById: Map<string, LeadMatch>) {
  const status = leadsById.get(leadId)?.contactStatus;
  return (status ? isReply(status) : false) || list.some((contact) => isReply(contact.status));
}

function groupStats(leadIds: Iterable<string>, leadsById: Map<string, LeadMatch>, period: PeriodStats, key: (lead: LeadMatch) => string): GroupStat[] {
  const groups = new Map<string, { leads: number; replied: number }>();
  for (const leadId of leadIds) {
    const lead = leadsById.get(leadId);
    const name = lead ? key(lead).trim() : "";
    if (!lead || !name) continue;
    const group = groups.get(name) ?? { leads: 0, replied: 0 };
    group.leads++;
    if (leadReplied(leadId, period.leads.get(leadId) ?? [], leadsById)) group.replied++;
    groups.set(name, group);
  }
  return [...groups].map(([name, group]) => ({ name, ...group, replyRate: ratio(group.replied, group.leads) }))
    .sort((a, b) => b.replyRate - a.replyRate || b.leads - a.leads || a.name.localeCompare(b.name))
    .slice(0, 6);
}

/**
 * Métricas del período [from, to] y del período anterior de igual duración (para las variaciones).
 * `contacts` puede traer ambos períodos; `leads` es el directorio de leads del usuario (estado actual).
 */
export function computeInsightMetrics(
  contacts: LeadContact[],
  leads: LeadMatch[],
  opts: { from: string; to: string; timeZone: string; now?: Date },
): InsightMetrics {
  const now = opts.now ?? new Date();
  const fromMs = Date.parse(opts.from);
  const toMs = Date.parse(opts.to);
  const prevFromMs = fromMs - (toMs - fromMs);
  const leadsById = new Map(leads.map((lead) => [lead.id, lead]));
  const current = contacts.filter((contact) => { const t = Date.parse(contact.contactedAt); return t >= fromMs && t <= toMs; });
  const previous = contacts.filter((contact) => { const t = Date.parse(contact.contactedAt); return t >= prevFromMs && t < fromMs; });
  const cur = periodStats(current, leadsById);
  const prev = periodStats(previous, leadsById);

  // Canal y hora se atribuyen al primer contacto del lead en el período.
  const channelLeads = new Map<ContactChannel, { leads: number; replied: number }>();
  const hourLeads = new Map<number, { leads: number; replied: number }>();
  for (const [leadId, list] of cur.leads) {
    const first = list[0];
    const replied = leadReplied(leadId, list, leadsById) ? 1 : 0;
    const channel = channelLeads.get(first.channel) ?? { leads: 0, replied: 0 };
    channel.leads++;
    channel.replied += replied;
    channelLeads.set(first.channel, channel);
    const hour = localParts(first.contactedAt, opts.timeZone).hour;
    const slot = hourLeads.get(hour) ?? { leads: 0, replied: 0 };
    slot.leads++;
    slot.replied += replied;
    hourLeads.set(hour, slot);
  }
  const sentByChannel = new Map<ContactChannel, number>();
  for (const contact of current) sentByChannel.set(contact.channel, (sentByChannel.get(contact.channel) ?? 0) + 1);
  const channels: ChannelStat[] = CHANNELS
    .map((channel) => {
      const stat = channelLeads.get(channel) ?? { leads: 0, replied: 0 };
      return { channel, sent: sentByChannel.get(channel) ?? 0, leads: stat.leads, replied: stat.replied, replyRate: ratio(stat.replied, stat.leads) };
    })
    .filter((stat) => stat.sent > 0)
    .sort((a, b) => b.sent - a.sent);

  const pickBest = <K,>(entries: [K, { leads: number; replied: number }][]) => {
    const ranked = entries.filter(([, stat]) => stat.leads >= MIN_SAMPLE && stat.replied > 0)
      .sort(([, a], [, b]) => ratio(b.replied, b.leads) - ratio(a.replied, a.leads) || b.leads - a.leads);
    return ranked[0] ?? null;
  };
  const bestChannelEntry = pickBest([...channelLeads]);
  const bestHourEntry = pickBest([...hourLeads]);

  // Tendencia diaria (≤ 31 días) o semanal, en fechas locales del usuario, con todos los cortes aunque estén en cero.
  const days = Math.max(1, Math.round((toMs - fromMs) / DAY_MS));
  const trendUnit = days <= 31 ? "day" : "week";
  const bucketOf = (iso: string) => { const date = localParts(iso, opts.timeZone).date; return trendUnit === "day" ? date : mondayOf(date); };
  const trendMap = new Map<string, { sent: number; replies: number }>();
  let cursor = bucketOf(opts.from);
  const last = bucketOf(opts.to);
  for (let guard = 0; cursor <= last && guard < 400; guard++) {
    trendMap.set(cursor, { sent: 0, replies: 0 });
    cursor = addDays(cursor, trendUnit === "day" ? 1 : 7);
  }
  const heat = { sent: grid(), replies: grid() };
  for (const contact of current) {
    const bucket = trendMap.get(bucketOf(contact.contactedAt));
    const parts = localParts(contact.contactedAt, opts.timeZone);
    if (isReply(contact.status)) {
      if (bucket) bucket.replies++;
      heat.replies[parts.weekday][parts.hour]++;
    } else {
      if (bucket) bucket.sent++;
      heat.sent[parts.weekday][parts.hour]++;
    }
  }

  // Embudo sobre los leads contactados en el período, según su estado actual (o una respuesta registrada).
  let replied = 0;
  let meeting = 0;
  let won = 0;
  for (const [leadId, list] of cur.leads) {
    const status = leadsById.get(leadId)?.contactStatus ?? "contacted";
    const logged = new Set(list.map((contact) => contact.status));
    const isWon = status === "won" || logged.has("won");
    const isMeeting = isWon || status === "meeting" || logged.has("meeting");
    if (isMeeting || leadReplied(leadId, list, leadsById)) replied++;
    if (isMeeting) meeting++;
    if (isWon) won++;
  }
  const counts: [FunnelStage, number][] = [["contacted", cur.leads.size], ["replied", replied], ["meeting", meeting], ["won", won]];
  const funnel = counts.map(([stage, count], index) => ({ stage, count, rateFromPrev: index === 0 ? null : counts[index - 1][1] ? count / counts[index - 1][1] : null }));

  // Seguimientos vencidos: sin respuesta y último contacto hace más de 3 días (histórico, no depende del rango).
  const overdue = leads
    .filter((lead) => lead.contactStatus === "contacted" && lead.lastContactedAt && now.getTime() - Date.parse(lead.lastContactedAt) > OVERDUE_DAYS * DAY_MS)
    .map((lead) => ({ id: lead.id, name: lead.name, category: lead.category, lastContactedAt: lead.lastContactedAt as string, days: Math.floor((now.getTime() - Date.parse(lead.lastContactedAt as string)) / DAY_MS) }))
    .sort((a, b) => b.days - a.days);

  return {
    range: { from: opts.from, to: opts.to },
    timeZone: opts.timeZone,
    totalContacts: current.length,
    kpis: {
      contacts: { value: cur.contacts, previous: prev.contacts },
      replyRate: { value: cur.replyRate, previous: prev.replyRate },
      avgReplyHours: { value: cur.avgReplyHours, previous: prev.avgReplyHours },
      bestChannel: bestChannelEntry ? { channel: bestChannelEntry[0], replyRate: ratio(bestChannelEntry[1].replied, bestChannelEntry[1].leads), leads: bestChannelEntry[1].leads } : null,
      bestHour: bestHourEntry ? { hour: bestHourEntry[0], replyRate: ratio(bestHourEntry[1].replied, bestHourEntry[1].leads), leads: bestHourEntry[1].leads } : null,
      overdue: overdue.length,
    },
    trendUnit,
    trend: [...trendMap].map(([date, value]) => ({ date, ...value })),
    funnel,
    channels,
    heat,
    categories: groupStats(cur.leads.keys(), leadsById, cur, (lead) => lead.category),
    cities: groupStats(cur.leads.keys(), leadsById, cur, (lead) => lead.city),
    overdue: overdue.slice(0, 10),
  };
}

// ---------- Análisis diario de Leadtita ----------

export type InsightLocale = "es" | "en";
export interface DailyAnalysis { observations: string[]; source: "model" | "fallback"; insufficient: boolean; generatedAt: string }
export const MIN_CONTACTS_FOR_ANALYSIS = 5;
const ANALYSIS_MODEL = "deepseek/deepseek-v4.1-flash";

const pct = (value: number) => `${Math.round(value * 100)}%`;
const channelNames: Record<InsightLocale, Record<ContactChannel, string>> = {
  es: { whatsapp: "WhatsApp", email: "email", phone: "teléfono", instagram: "Instagram", linkedin: "LinkedIn", in_person: "en persona", other: "otros canales" },
  en: { whatsapp: "WhatsApp", email: "email", phone: "phone", instagram: "Instagram", linkedin: "LinkedIn", in_person: "in person", other: "other channels" },
};

/** Observaciones determinísticas: se usan sin modelo, cuando el modelo falla o con pocos datos. */
export function fallbackAnalysis(metrics: InsightMetrics, locale: InsightLocale, now = new Date()): DailyAnalysis {
  const es = locale === "es";
  const names = channelNames[locale];
  const out: string[] = [];
  const insufficient = metrics.totalContacts < MIN_CONTACTS_FOR_ANALYSIS;
  if (insufficient) {
    out.push(es
      ? `Con ${metrics.totalContacts} contacto${metrics.totalContacts === 1 ? "" : "s"} registrado${metrics.totalContacts === 1 ? "" : "s"} en los últimos 30 días todavía no hay patrones confiables.`
      : `With ${metrics.totalContacts} logged contact${metrics.totalContacts === 1 ? "" : "s"} in the last 30 days there are no reliable patterns yet.`);
    out.push(es
      ? "Registrá cada contacto con canal y hora, y marcá cuando un lead responde, agenda reunión o se gana: con eso mido tasa de respuesta y tiempos."
      : "Log every contact with its channel and time, and mark when a lead replies, books a meeting or is won: that is what I use to measure reply rate and timing.");
    out.push(es
      ? `Para mañana: sumá al menos ${MIN_CONTACTS_FOR_ANALYSIS - metrics.totalContacts + 3} contactos más, probando dos canales distintos, así puedo empezar a comparar.`
      : `For tomorrow: log at least ${MIN_CONTACTS_FOR_ANALYSIS - metrics.totalContacts + 3} more contacts across two different channels so I can start comparing.`);
  }
  const { kpis } = metrics;
  if (!insufficient && kpis.replyRate.value !== null) {
    out.push(es
      ? `Tu tasa de respuesta es ${pct(kpis.replyRate.value)} sobre ${metrics.funnel[0].count} leads contactados.`
      : `Your reply rate is ${pct(kpis.replyRate.value)} across ${metrics.funnel[0].count} contacted leads.`);
  }
  if (kpis.bestChannel) {
    out.push(es
      ? `${names[kpis.bestChannel.channel]} es tu mejor canal (${pct(kpis.bestChannel.replyRate)} de respuesta en ${kpis.bestChannel.leads} leads): priorizalo mañana.`
      : `${names[kpis.bestChannel.channel]} is your best channel (${pct(kpis.bestChannel.replyRate)} reply rate across ${kpis.bestChannel.leads} leads): prioritize it tomorrow.`);
  }
  if (kpis.bestHour) {
    out.push(es
      ? `Los contactos cerca de las ${kpis.bestHour.hour} h responden más (${pct(kpis.bestHour.replyRate)}): probá concentrar envíos en esa franja.`
      : `Contacts around ${kpis.bestHour.hour}:00 reply more (${pct(kpis.bestHour.replyRate)}): try batching outreach in that window.`);
  }
  if (kpis.overdue > 0) {
    const oldest = metrics.overdue[0];
    out.push(es
      ? `Tenés ${kpis.overdue} seguimiento${kpis.overdue === 1 ? "" : "s"} vencido${kpis.overdue === 1 ? "" : "s"}${oldest ? `; empezá por ${oldest.name} (${oldest.days} días sin respuesta)` : ""}.`
      : `You have ${kpis.overdue} overdue follow-up${kpis.overdue === 1 ? "" : "s"}${oldest ? `; start with ${oldest.name} (${oldest.days} days without a reply)` : ""}.`);
  }
  if (out.length < 3 && !insufficient) {
    out.push(es ? "Registrá también las respuestas para que pueda comparar canales y horarios." : "Also log replies so I can compare channels and times.");
  }
  return { observations: out.slice(0, 5), source: "fallback", insufficient, generatedAt: now.toISOString() };
}

/** Resumen compacto (sin datos personales más allá de nombres de rubro/zona) que recibe el modelo. */
export function analysisInput(metrics: InsightMetrics) {
  // Porcentajes enteros y días con nombre: el modelo los cita tal cual, sin decimales ni "día 0".
  const percent = (value: number | null) => (value === null ? null : Math.round(value * 100));
  const hours = (value: number | null) => (value === null ? null : Math.round(value * 10) / 10);
  const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const peak = (cells: number[][]) => cells.flatMap((row, day) => row.map((count, hour) => ({ day: weekdays[day], hour, count })))
    .filter((cell) => cell.count > 0).sort((a, b) => b.count - a.count).slice(0, 5);
  const group = ({ name, leads, replied, replyRate }: GroupStat) => ({ name, leads, replied, replyRatePct: percent(replyRate) });
  const { bestHour } = metrics.kpis;
  return {
    days: metrics.trend.length,
    contacts: metrics.kpis.contacts,
    replyRatePct: { value: percent(metrics.kpis.replyRate.value), previous: percent(metrics.kpis.replyRate.previous) },
    avgReplyHours: { value: hours(metrics.kpis.avgReplyHours.value), previous: hours(metrics.kpis.avgReplyHours.previous) },
    funnel: metrics.funnel.map(({ stage, count }) => ({ stage, count })),
    channels: metrics.channels.map(({ channel, sent, leads, replied, replyRate }) => ({ channel, sent, leads, replied, replyRatePct: percent(replyRate) })),
    bestHour: bestHour ? { hour: bestHour.hour, leads: bestHour.leads, replyRatePct: percent(bestHour.replyRate) } : null,
    sentPeaks: peak(metrics.heat.sent),
    replyPeaks: peak(metrics.heat.replies),
    categories: metrics.categories.map(group),
    cities: metrics.cities.map(group),
    overdueFollowUps: metrics.kpis.overdue,
    oldestOverdue: metrics.overdue.slice(0, 3).map(({ name, days }) => ({ name, days })),
  };
}

/** Valida la respuesta del modelo: 3–5 observaciones de texto, cortas. */
export function parseObservations(content: string): string[] | null {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return null;
  }
  const list = (value as { observations?: unknown })?.observations;
  if (!Array.isArray(list)) return null;
  const clean = list.filter((item): item is string => typeof item === "string").map((item) => item.trim().slice(0, 320)).filter(Boolean);
  return clean.length >= 3 ? clean.slice(0, 5) : null;
}

/** Pide al modelo 3–5 observaciones accionables basadas solo en los datos. Lanza si el modelo falla o responde inválido. */
export async function requestDailyAnalysis(apiKey: string, metrics: InsightMetrics, locale: InsightLocale, now = new Date(), userId?: string): Promise<DailyAnalysis> {
  const system = [
    "You are Leadtita, the Lead Suite assistant in leadta. You review a salesperson's outreach log once a day.",
    `Write 3 to 5 short, actionable observations in ${locale === "es" ? "Rioplatense Spanish (voseo)" : "English"}, one sentence each.`,
    "Use ONLY the numbers in the JSON. Never invent data, leads or percentages. Mention channel/time/category patterns, overdue follow-ups and one concrete thing to try tomorrow.",
    "Hours are local hours (0-23). Fields ending in Pct are whole percentages: write them as \"50%\", never as decimals. Translate weekday names. If a sample is small (fewer than 3 leads), say it is a weak signal.",
    'Reply only with JSON: {"observations": ["..."]}.',
  ].join(" ");
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: ANALYSIS_MODEL,
      provider: { require_parameters: true, sort: "price" },
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "lead_suite_daily_analysis",
          strict: true,
          schema: { type: "object", additionalProperties: false, properties: { observations: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 5 } }, required: ["observations"] },
        },
      },
      plugins: [{ id: "response-healing" }],
      messages: [{ role: "system", content: system }, { role: "user", content: JSON.stringify(analysisInput(metrics)) }],
      // Modelo con razonamiento: el presupuesto cubre el razonamiento (bajo) y la respuesta JSON.
      reasoning: { effort: "low" },
      max_tokens: 3000,
      temperature: 0.3,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`OpenRouter responded ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const payload = await response.json() as { choices?: { message?: { content?: unknown } }[]; usage?: unknown };
  void recordAiUsage({ feature: "lead_suite_insights", model: ANALYSIS_MODEL, userId, usage: payload.usage });
  const content = payload.choices?.[0]?.message?.content;
  const observations = typeof content === "string" ? parseObservations(content) : null;
  if (!observations) throw new Error("Invalid analysis from model.");
  return { observations, source: "model", insufficient: false, generatedAt: now.toISOString() };
}
