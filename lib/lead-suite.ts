export const CONTACT_CHANNELS = ["whatsapp", "email", "phone", "instagram", "linkedin", "in_person", "other"] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];
export const CONTACT_STATUSES = ["contacted", "replied", "meeting", "won", "lost"] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];
export type LeadContactStatus = "not_contacted" | ContactStatus;

export interface LeadMatch { id: string; name: string; category: string; city: string; phone: string; website: string; batchId: string; contactStatus: LeadContactStatus; lastContactedAt: string | null; }
export interface LeadContact { id: string; leadId: string; leadName: string; channel: ContactChannel; message: string; status: ContactStatus; notes: string; contactedAt: string; created: string; }
export interface RecordContactInput { leadId: string; channel: ContactChannel; message: string; contactedAt: string; status?: ContactStatus; notes?: string; }
export interface LeadSuiteMetrics {
  range: { from: string; to: string };
  totalContactedLeads: number;
  contactsInRange: number;
  leadsContactedInRange: number;
  byChannel: Record<ContactChannel, number>;
  byStatus: Record<LeadContactStatus, number>;
  byWeek: { weekStart: string; count: number }[];
  byCategory: { category: string; count: number }[];
  byHour: number[];
  replyRate: number;
  pendingFollowUps: LeadMatch[];
}
export interface WeeklyReport { weekStart: string; summary: string; suggestions: string[]; metrics: LeadSuiteMetrics; sentAt: string | null; }

// ponytail: fixed product timezone for "local hour"; take it per user if users get a timezone field.
export const LEAD_SUITE_TIMEZONE = "America/Argentina/Buenos_Aires";
const DAY_MS = 86_400_000;
const FOLLOW_UP_AFTER_MS = 3 * DAY_MS;

const CHANNEL_ALIASES: Record<string, ContactChannel> = {
  wa: "whatsapp", wpp: "whatsapp", whatsapp: "whatsapp", "whats app": "whatsapp",
  mail: "email", email: "email", "e-mail": "email", correo: "email",
  phone: "phone", telefono: "phone", "teléfono": "phone", llamada: "phone", call: "phone",
  instagram: "instagram", ig: "instagram",
  linkedin: "linkedin",
  in_person: "in_person", "in person": "in_person", presencial: "in_person", "en persona": "in_person",
  other: "other", otro: "other",
};

export function normalizeChannel(value: unknown): ContactChannel {
  if (typeof value !== "string") return "other";
  return CHANNEL_ALIASES[value.trim().toLowerCase()] ?? "other";
}

export function isContactStatus(value: unknown): value is ContactStatus {
  return typeof value === "string" && (CONTACT_STATUSES as readonly string[]).includes(value);
}

export function normalizeLeadStatus(value: unknown): LeadContactStatus {
  return isContactStatus(value) ? value : "not_contacted";
}

/** Monday 00:00 UTC of the ISO week containing `date`, as YYYY-MM-DD. */
export function weekStartIso(date: Date | string): string {
  const d = new Date(date);
  const day = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)).toISOString().slice(0, 10);
}

/** PocketBase stores dates as "YYYY-MM-DD HH:MM:SS.sssZ"; filters must use the same shape. */
export function toPbDate(value: string | Date): string {
  return new Date(value).toISOString().replace("T", " ");
}

/** PocketBase date → ISO string ("" stays null). */
export function fromPbDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function localHour(iso: string, timeZone: string) {
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(new Date(iso)));
  return hour % 24;
}

export interface MetricsContactRow { leadId: string; channel: ContactChannel; contactedAt: string; }

/** Single pass over all of a user's contacts plus the contacted leads. */
export function computeLeadSuiteMetrics(
  contacts: MetricsContactRow[],
  leads: Map<string, LeadMatch>,
  range: { from: string; to: string },
  now: Date = new Date(),
  timeZone: string = LEAD_SUITE_TIMEZONE,
): LeadSuiteMetrics {
  const from = new Date(range.from).getTime();
  const to = new Date(range.to).getTime();
  const byChannel = Object.fromEntries(CONTACT_CHANNELS.map((c) => [c, 0])) as Record<ContactChannel, number>;
  const byStatus = { not_contacted: 0, ...Object.fromEntries(CONTACT_STATUSES.map((s) => [s, 0])) } as Record<LeadContactStatus, number>;
  const byHour = new Array<number>(24).fill(0);
  const weeks: string[] = [];
  const currentWeek = new Date(weekStartIso(now)).getTime();
  for (let i = 7; i >= 0; i--) weeks.push(new Date(currentWeek - i * 7 * DAY_MS).toISOString().slice(0, 10));
  const weekCounts = new Map(weeks.map((w) => [w, 0]));
  const categoryCounts = new Map<string, number>();
  const allLeads = new Set<string>();
  const rangeLeads = new Set<string>();
  let contactsInRange = 0;

  for (const contact of contacts) {
    allLeads.add(contact.leadId);
    const week = weekStartIso(contact.contactedAt);
    if (weekCounts.has(week)) weekCounts.set(week, weekCounts.get(week)! + 1);
    const time = new Date(contact.contactedAt).getTime();
    if (time < from || time > to) continue;
    contactsInRange++;
    byChannel[contact.channel] = (byChannel[contact.channel] ?? 0) + 1;
    byHour[localHour(contact.contactedAt, timeZone)]++;
    if (!rangeLeads.has(contact.leadId)) {
      rangeLeads.add(contact.leadId);
      const category = leads.get(contact.leadId)?.category.trim() || "";
      if (category) categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
    }
  }

  let replied = 0;
  const pending: LeadMatch[] = [];
  for (const leadId of allLeads) {
    const lead = leads.get(leadId);
    const status = lead?.contactStatus ?? "contacted";
    const effective = status === "not_contacted" ? "contacted" : status;
    byStatus[effective]++;
    if (effective === "replied" || effective === "meeting" || effective === "won") replied++;
    if (lead && effective === "contacted" && lead.lastContactedAt && now.getTime() - new Date(lead.lastContactedAt).getTime() > FOLLOW_UP_AFTER_MS) pending.push(lead);
  }
  pending.sort((a, b) => (a.lastContactedAt! < b.lastContactedAt! ? -1 : 1));

  return {
    range,
    totalContactedLeads: allLeads.size,
    contactsInRange,
    leadsContactedInRange: rangeLeads.size,
    byChannel,
    byStatus,
    byWeek: weeks.map((weekStart) => ({ weekStart, count: weekCounts.get(weekStart)! })),
    byCategory: [...categoryCounts].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count || a.category.localeCompare(b.category)).slice(0, 8),
    byHour,
    replyRate: allLeads.size ? replied / allLeads.size : 0,
    pendingFollowUps: pending.slice(0, 10),
  };
}

const NAME_STOPWORDS = new Set(["llc", "inc", "sa", "srl", "sas", "ltd", "co", "the", "de", "del", "la", "las", "el", "los", "y", "and", "&"]);

/** Lowercase, no accents, alphanumerics separated by single spaces. */
export function normalizeForMatch(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * 0..1 match of a lead name inside free text (accents/case-insensitive, partial names allowed).
 * 1 = the whole name appears; otherwise the share of meaningful name tokens found in the text.
 */
export function leadNameScore(name: string, text: string): number {
  const normalizedName = normalizeForMatch(name);
  const normalizedText = ` ${normalizeForMatch(text)} `;
  if (!normalizedName) return 0;
  if (normalizedText.includes(` ${normalizedName} `)) return 1;
  const tokens = normalizedName.split(" ").filter((token) => token.length > 1 && !NAME_STOPWORDS.has(token));
  if (!tokens.length) return 0;
  const textTokens = new Set(normalizedText.trim().split(" "));
  const hits = tokens.filter((token) => textTokens.has(token) || (token.length >= 4 && [...textTokens].some((word) => word.length >= 4 && (word.startsWith(token) || token.startsWith(word))))).length;
  return hits / tokens.length * 0.9;
}

/** Leads whose names best match the text, best first; ties keep the most recently contacted. */
export function rankLeadsByText<T extends { name: string; lastContactedAt?: string | null }>(leads: T[], text: string, limit = 8, minScore = 0.5): (T & { score: number })[] {
  return leads
    .map((lead) => ({ ...lead, score: leadNameScore(lead.name, text) }))
    .filter((lead) => lead.score >= minScore)
    .sort((a, b) => b.score - a.score || (b.lastContactedAt ?? "").localeCompare(a.lastContactedAt ?? ""))
    .slice(0, limit);
}
