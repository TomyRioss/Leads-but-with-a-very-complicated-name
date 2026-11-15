import { filterString, listRecords, pocketBaseDate } from "@/app/api/owner/_shared";
import { PocketBaseRequestError, pocketBaseFetch } from "@/lib/server/pocketbase";

// Owner traceability: read-only (superuser) timeline built from the existing collections. Field names come from
// pb_migrations (lead_contacts/lead_suite_reports 1794350000, ai_usage 1794410000, lead_batches 1762471200/1794380000,
// subscription_payments 1794092428, users 1794320000) and leadtita_conversations (ORQ-1-0170 contract).

export const TRACE_TYPES = ["conversation", "email_sent", "email_system", "batch", "people_search", "ai_usage", "payment"] as const;
export type TraceType = typeof TRACE_TYPES[number];
export const TRACE_PER_PAGE = 50;
/** ponytail: k-way merge reads page*50 rows per source; capped at 10 pages (500 events). Add cursors if owners need deeper history. */
export const TRACE_MAX_PAGE = 10;
/** ponytail: ai_usage is grouped in memory from the newest 1000 rows of the range; a PB view would be needed for exact totals. */
const AI_USAGE_SCAN = 1000;

export type TraceEvent = {
  id: string;
  type: TraceType;
  at: string;
  userId: string;
  userEmail: string;
  title: string;
  summary: string;
  refId: string;
  /** Extra fields the UI shows in a dialog (email body, counts, amounts…). */
  detail?: Record<string, string | number>;
};

export type TraceQuery = { user: string; types: TraceType[]; from: Date | null; to: Date | null; page: number };
export type TracePage = { items: TraceEvent[]; page: number; totalPages: number; totalItems: number; unavailable: TraceType[] };

type UserExpand = { expand?: { user?: { id: string; email: string } } };
type SourceResult = { events: TraceEvent[]; total: number };

const isRecordId = (value: string) => /^[a-z0-9]{15}$/.test(value);
const emailOf = (row: UserExpand) => row.expand?.user?.email ?? "";
const text = (value: unknown, max: number) => (typeof value === "string" ? value : value == null ? "" : String(value)).slice(0, max);

/** Filter on the user relation (`field` = "user" or "id" for the users collection). */
function userFilter(user: string, field: string) {
  if (!user) return "";
  if (isRecordId(user)) return `${field} = ${filterString(user)}`;
  return `${field === "id" ? "email" : `${field}.email`} ~ ${filterString(user)}`;
}

function rangeFilter(field: string, from: Date | null, to: Date | null) {
  return [from && `${field} >= ${filterString(pocketBaseDate(from))}`, to && `${field} <= ${filterString(pocketBaseDate(to))}`];
}

const joinFilter = (parts: (string | null | false | undefined)[]) => parts.filter(Boolean).join(" && ");

async function list<T>(collection: string, filter: string, sort: string, perPage: number, fields: string, expand = "user") {
  return listRecords<T>(collection, { page: 1, perPage, sort, fields, ...(expand ? { expand } : {}), ...(filter ? { filter } : {}) });
}

const userFields = "expand.user.id,expand.user.email";

async function conversations(q: TraceQuery, take: number): Promise<SourceResult> {
  type Row = UserExpand & { id: string; user: string; title?: string; message_count?: number; last_message_at?: string; updated: string };
  try {
    const result = await list<Row>("leadtita_conversations", joinFilter([userFilter(q.user, "user"), ...rangeFilter("updated", q.from, q.to)]), "-updated", take, `id,user,title,message_count,last_message_at,updated,${userFields}`);
    return {
      total: result.totalItems,
      events: result.items.map((row) => ({
        id: `conversation:${row.id}`, type: "conversation", at: row.last_message_at || row.updated, userId: row.user, userEmail: emailOf(row),
        title: text(row.title, 200), summary: "", refId: row.id, detail: { messages: row.message_count ?? 0 },
      })),
    };
  } catch (error) {
    // The collection arrives with ORQ-1-0170; until its migration is applied there is simply nothing to show.
    if (error instanceof PocketBaseRequestError && error.status === 404) return { events: [], total: 0 };
    throw error;
  }
}

async function emailsSent(q: TraceQuery, take: number): Promise<SourceResult> {
  type Row = UserExpand & { id: string; user: string; message?: string; status: string; contacted_at: string; expand?: { lead?: { name?: string; email?: string } } };
  const result = await list<Row>(
    "lead_contacts",
    joinFilter([`channel = "email"`, userFilter(q.user, "user"), ...rangeFilter("contacted_at", q.from, q.to)]),
    "-contacted_at", take, `id,user,message,status,contacted_at,${userFields},expand.lead.name,expand.lead.email`, "user,lead",
  );
  return {
    total: result.totalItems,
    events: result.items.map((row) => {
      // lead_contacts.message for emails is "subject\n\nbody" (leadtita-tools emailLog).
      const [subject, ...rest] = (row.message ?? "").split("\n\n");
      const leadName = text(row.expand?.lead?.name, 255);
      return {
        id: `email_sent:${row.id}`, type: "email_sent", at: row.contacted_at, userId: row.user, userEmail: emailOf(row),
        title: text(subject, 200), summary: leadName, refId: row.id,
        detail: { subject: text(subject, 200), body: text(rest.join("\n\n"), 4000), to: text(row.expand?.lead?.email, 500), leadName, status: row.status },
      };
    }),
  };
}

async function systemEmails(q: TraceQuery, take: number): Promise<SourceResult> {
  type UserRow = { id: string; email: string; verification_sent_at?: string; welcome_email_sent_at?: string };
  type ReportRow = UserExpand & { id: string; user: string; week_start: string; sent_at: string };
  const byUser = (field: "verification_sent_at" | "welcome_email_sent_at") => list<UserRow>(
    "users", joinFilter([`${field} != ""`, userFilter(q.user, "id"), ...rangeFilter(field, q.from, q.to)]), `-${field}`, take, `id,email,${field}`, "",
  );
  const [verification, welcome, reports] = await Promise.all([
    byUser("verification_sent_at"),
    byUser("welcome_email_sent_at"),
    list<ReportRow>("lead_suite_reports", joinFilter([`sent_at != ""`, userFilter(q.user, "user"), ...rangeFilter("sent_at", q.from, q.to)]), "-sent_at", take, `id,user,week_start,sent_at,${userFields}`),
  ]);
  const fromUsers = (rows: UserRow[], kind: "verification" | "welcome", field: "verification_sent_at" | "welcome_email_sent_at"): TraceEvent[] => rows.map((row) => ({
    id: `email_system:${kind}:${row.id}`, type: "email_system", at: row[field] ?? "", userId: row.id, userEmail: row.email, title: kind, summary: "", refId: row.id, detail: { kind },
  }));
  return {
    total: verification.totalItems + welcome.totalItems + reports.totalItems,
    events: [
      ...fromUsers(verification.items, "verification", "verification_sent_at"),
      ...fromUsers(welcome.items, "welcome", "welcome_email_sent_at"),
      ...reports.items.map((row): TraceEvent => ({
        id: `email_system:report:${row.id}`, type: "email_system", at: row.sent_at, userId: row.user, userEmail: emailOf(row), title: "weekly_report", summary: row.week_start, refId: row.id, detail: { kind: "weekly_report", weekStart: row.week_start },
      })),
    ],
  };
}

function keywordsText(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item)).join(", ") : typeof value === "string" ? value : "";
}

async function batches(q: TraceQuery, take: number, people: boolean): Promise<SourceResult> {
  type Row = UserExpand & { id: string; user?: string; keywords: unknown; query?: string; country: string; province?: string; district?: string; requested_count: number; result_count?: number; status: string; created_at: string };
  // Legacy rows have no `kind`: everything that is not "person" is a business search.
  const result = await list<Row>(
    "lead_batches",
    joinFilter([people ? `kind = "person"` : `kind != "person"`, userFilter(q.user, "user"), ...rangeFilter("created_at", q.from, q.to)]),
    "-created_at", take, `id,user,keywords,query,country,province,district,requested_count,result_count,status,created_at,${userFields}`,
  );
  return {
    total: result.totalItems,
    events: result.items.map((row) => {
      const place = [row.district, row.province, row.country].filter(Boolean).join(", ");
      return {
        id: `${people ? "people_search" : "batch"}:${row.id}`, type: people ? "people_search" : "batch", at: row.created_at, userId: row.user ?? "", userEmail: emailOf(row),
        title: text(people ? row.query || keywordsText(row.keywords) : keywordsText(row.keywords), 300), summary: place, refId: row.id,
        detail: { status: row.status, requested: row.requested_count, results: row.result_count ?? 0, place },
      };
    }),
  };
}

async function aiUsage(q: TraceQuery): Promise<SourceResult> {
  type Row = UserExpand & { id: string; user?: string; feature: string; model?: string; prompt_tokens?: number; completion_tokens?: number; cost_usd?: number; created_at: string };
  const result = await list<Row>(
    "ai_usage", joinFilter([userFilter(q.user, "user"), ...rangeFilter("created_at", q.from, q.to)]), "-created_at", AI_USAGE_SCAN,
    `id,user,feature,model,prompt_tokens,completion_tokens,cost_usd,created_at,${userFields}`,
  );
  // One event per (day, user, feature) so a chatty day does not flood the timeline.
  const groups = new Map<string, TraceEvent & { detail: Record<string, string | number> }>();
  for (const row of result.items) {
    const day = row.created_at.slice(0, 10);
    const key = `${day}|${row.user ?? ""}|${row.feature}`;
    const group = groups.get(key) ?? {
      id: `ai_usage:${key}`, type: "ai_usage" as const, at: row.created_at, userId: row.user ?? "", userEmail: emailOf(row), title: row.feature, summary: "", refId: "",
      detail: { calls: 0, tokens: 0, costUsd: 0, models: "" },
    };
    group.detail.calls = Number(group.detail.calls) + 1;
    group.detail.tokens = Number(group.detail.tokens) + (row.prompt_tokens ?? 0) + (row.completion_tokens ?? 0);
    group.detail.costUsd = Math.round((Number(group.detail.costUsd) + (row.cost_usd ?? 0)) * 1e6) / 1e6;
    const models = String(group.detail.models).split(", ").filter(Boolean);
    if (row.model && !models.includes(row.model)) group.detail.models = [...models, row.model].slice(0, 4).join(", ");
    groups.set(key, group);
  }
  const events = [...groups.values()];
  return { events, total: events.length };
}

async function payments(q: TraceQuery, take: number): Promise<SourceResult> {
  type Row = UserExpand & { id: string; user: string; payment_id: string; status: string; amount_ars?: number; credits?: number; created: string };
  const result = await list<Row>(
    "subscription_payments", joinFilter([userFilter(q.user, "user"), ...rangeFilter("created", q.from, q.to)]), "-created", take,
    `id,user,payment_id,status,amount_ars,credits,created,${userFields}`,
  );
  return {
    total: result.totalItems,
    events: result.items.map((row) => ({
      id: `payment:${row.id}`, type: "payment", at: row.created, userId: row.user, userEmail: emailOf(row), title: row.payment_id, summary: row.status, refId: row.id,
      detail: { status: row.status, amountArs: row.amount_ars ?? 0, credits: row.credits ?? 0 },
    })),
  };
}

const sources: Record<TraceType, (q: TraceQuery, take: number) => Promise<SourceResult>> = {
  conversation: conversations,
  email_sent: emailsSent,
  email_system: systemEmails,
  batch: (q, take) => batches(q, take, false),
  people_search: (q, take) => batches(q, take, true),
  ai_usage: aiUsage,
  payment: payments,
};

const time = (value: string) => Date.parse(value.replace(" ", "T")) || 0;

/** Newest-first merge of every requested source; a source that fails is reported in `unavailable` instead of failing the page. */
export async function listTraceEvents(q: TraceQuery): Promise<TracePage> {
  const take = q.page * TRACE_PER_PAGE;
  const settled = await Promise.all(q.types.map(async (type) => {
    try {
      return { type, result: await sources[type](q, take) };
    } catch (error) {
      console.error(`Owner traceability source ${type} failed:`, error instanceof PocketBaseRequestError ? error.status : error instanceof Error ? error.name : "unknown");
      return { type, result: null };
    }
  }));
  const events = settled.flatMap((entry) => entry.result?.events ?? []).sort((a, b) => time(b.at) - time(a.at));
  const totalItems = Math.min(settled.reduce((sum, entry) => sum + (entry.result?.total ?? 0), 0), TRACE_MAX_PAGE * TRACE_PER_PAGE);
  return {
    items: events.slice((q.page - 1) * TRACE_PER_PAGE, take),
    page: q.page,
    totalPages: Math.max(1, Math.ceil(totalItems / TRACE_PER_PAGE)),
    totalItems,
    unavailable: settled.filter((entry) => !entry.result).map((entry) => entry.type),
  };
}

// --- Conversation detail -------------------------------------------------------------------------------------------

export type TraceCardState = "confirmed" | "rejected" | "pending" | "failed" | "expired";
export type TraceCard = { token: string; kind: string; leadName: string; state: TraceCardState; email?: { to: string; subject: string; body: string } };
export type TraceMessage = { role: "user" | "assistant"; content: string; at: number | null; tools: string[]; cards: TraceCard[]; attachments: string[] };
export type TraceConversation = { id: string; userId: string; userEmail: string; title: string; created: string; updated: string; messages: TraceMessage[] };

const asObject = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});

function cardState(raw: unknown): TraceCardState {
  if (raw === "done") return "confirmed";
  if (raw === "cancelled") return "rejected";
  if (raw === "error") return "failed";
  if (raw === "expired" || raw === "stale") return "expired";
  return "pending";
}

/** messages/extra are written by the client: normalize defensively and cap sizes before sending them to the panel. */
function normalizeMessages(messages: unknown, extra: unknown): TraceMessage[] {
  const cards = asObject(asObject(extra).cards);
  return (Array.isArray(messages) ? messages : []).slice(-200).map((raw): TraceMessage => {
    const message = asObject(raw);
    const actions = (Array.isArray(message.actions) ? message.actions : []).map(asObject);
    return {
      role: message.role === "user" ? "user" : "assistant",
      content: text(message.content, 8000),
      at: typeof message.at === "number" && Number.isFinite(message.at) ? message.at : null,
      tools: [...new Set(actions.map((action) => (action.type === "pending_change" ? text(asObject(action.change).kind, 40) : text(action.type, 40))).filter(Boolean))],
      cards: actions.filter((action) => action.type === "pending_change").map((action) => {
        const change = asObject(action.change);
        const changeExtra = asObject(change.extra);
        const token = text(action.token, 2000);
        const kind = text(change.kind, 40);
        return {
          token, kind, leadName: text(change.leadName, 255), state: cardState(cards[token]),
          ...(kind === "send_email" ? { email: { to: text(changeExtra.to, 500), subject: text(changeExtra.subject, 200), body: text(changeExtra.body, 5000) } } : {}),
        };
      }),
      attachments: (Array.isArray(message.attachments) ? message.attachments : []).map((item) => text(asObject(item).name, 200)).filter(Boolean),
    };
  });
}

/** Full conversation for the owner; null when it does not exist (or the collection is not migrated yet). */
export async function getTraceConversation(id: string): Promise<TraceConversation | null> {
  type Row = UserExpand & { id: string; user: string; title?: string; messages?: unknown; extra?: unknown; created: string; updated: string };
  try {
    const row = await pocketBaseFetch<Row>(`/api/collections/leadtita_conversations/records/${encodeURIComponent(id)}?expand=user&fields=id,user,title,messages,extra,created,updated,${userFields}`);
    return { id: row.id, userId: row.user, userEmail: emailOf(row), title: text(row.title, 200), created: row.created, updated: row.updated, messages: normalizeMessages(row.messages, row.extra) };
  } catch (error) {
    if (error instanceof PocketBaseRequestError && error.status === 404) return null;
    throw error;
  }
}
