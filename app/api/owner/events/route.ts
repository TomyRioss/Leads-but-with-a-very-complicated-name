import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/server/owner";
import { errorResponse, pocketBaseNotReady } from "../_shared";
import { errorTranslator } from "@/lib/server/locale";
import { pocketBaseFetch } from "@/lib/server/pocketbase";

const limit = 20;
/** Newest rows read per source; also bounds the deepest page (maxFetch / limit). */
const maxFetch = 200;
const maxPage = maxFetch / limit;
const excerptLength = 160;
/** Per-source budget (superuser login + list). A slow source is dropped instead of holding the whole feed. */
const sourceTimeoutMs = 8000;

const eventTypes =["signup", "verified", "leads", "people", "chat", "generated", "contact", "scheduled"] as const;
type EventType = (typeof eventTypes)[number];
type Details = Record<string, string | number>;
type OwnerEvent = { id: string; type: EventType; email: string; count: number; date: string; status?: string; excerpt?: string; details: Details };
type UserExpand = { expand?: { user?: { id: string; email: string } } };

type UserRow = { id: string; email: string; name?: string; created: string; welcome_email_sent_at?: string };
type BatchRow = UserExpand & {
  id: string;
  user?: string;
  kind?: string;
  query?: string;
  keywords: unknown;
  country: string;
  province?: string;
  district?: string;
  requested_count: number;
  result_count?: number;
  status: string;
  created_at: string;
};
type TurnRow = UserExpand & { id: string; user: string; conversation_id: string; turn_id: string; status: string; result?: unknown; error_code?: string; created: string };
type ContactRow = UserExpand & {
  id: string;
  user: string;
  lead: string;
  channel: string;
  message?: string;
  status: string;
  notes?: string;
  contacted_at: string;
  created: string;
  expand?: { lead?: { id: string; name?: string } };
};
type ScheduledRow = UserExpand & {
  id: string;
  user: string;
  channel: string;
  lead_id: string;
  lead_name?: string;
  recipient: string;
  subject?: string;
  body?: string;
  send_at: string;
  status: string;
  error?: string;
  sent_at?: string;
  created: string;
};

const time = (value: string) => Date.parse(value.replace(" ", "T")) || 0;
const asObject = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});
const str = (value: unknown, max = 200) => (typeof value === "string" ? value.slice(0, max) : "");
const excerpt = (value: unknown) => {
  const clean = str(value, excerptLength * 4).replace(/\s+/g, " ").trim();
  return clean.length > excerptLength ? `${clean.slice(0, excerptLength - 1)}…` : clean;
};
const userFields = "expand.user.id,expand.user.email";
const emailOf = (row: UserExpand) => row.expand?.user?.email ?? "";

type ListResponse<T> = { items: T[] };

class SourceTimeoutError extends Error {
  constructor() {
    super("PocketBase source timed out.");
    this.name = "SourceTimeoutError";
  }
}

/** Bounded list read: the signal aborts the list request, the race also covers the superuser login inside pocketBaseFetch. */
function listSource<T>(collection: string, params: Record<string, string | number>) {
  const query = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)]));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new SourceTimeoutError()), sourceTimeoutMs); });
  const request = pocketBaseFetch<ListResponse<T>>(`/api/collections/${collection}/records?${query}`, { signal: AbortSignal.timeout(sourceTimeoutMs) });
  return Promise.race([request, timeout]).finally(() => clearTimeout(timer));
}

function parsePage(value: string | null) {
  if (value === null || value === "") return 1;
  if (!/^\d{1,3}$/.test(value)) return null;
  const page = Number(value);
  return page >= 1 && page <= maxPage ? page : null;
}

function batchEvent(batch: BatchRow): OwnerEvent {
  const person = batch.kind === "person";
  const zone = [batch.district, batch.province, batch.country].filter(Boolean).join(", ");
  const keywords = Array.isArray(batch.keywords) ? batch.keywords.map(String).join(", ") : typeof batch.keywords === "string" ? batch.keywords : "";
  return {
    id: `${person ? "people" : "leads"}-${batch.id}`,
    type: person ? "people" : "leads",
    email: emailOf(batch),
    count: batch.result_count ?? 0,
    date: batch.created_at,
    status: batch.status,
    details: {
      batchId: batch.id,
      userId: batch.user ?? "",
      email: emailOf(batch),
      ...(person ? { query: str(batch.query, 300) } : { keywords }),
      ...(zone ? { zone } : {}),
      requestedCount: batch.requested_count,
      resultCount: batch.result_count ?? 0,
    },
  };
}

/** One `chat` event per turn plus one `generated` event when the turn produced message suggestions. */
function turnEvents(turn: TurnRow, wanted: (type: EventType) => boolean): OwnerEvent[] {
  const result = asObject(turn.result);
  const actions = (Array.isArray(result.actions) ? result.actions : []).slice(0, 20).map(asObject);
  const counts = new Map<string, number>();
  const changeKinds = new Set<string>();
  const suggestions = actions.filter((action) => action.type === "message_suggestions");
  for (const action of actions) {
    const type = str(action.type, 40);
    if (!type) continue;
    counts.set(type, (counts.get(type) ?? 0) + 1);
    if (type === "pending_change") { const kind = str(asObject(action.change).kind, 40); if (kind) changeKinds.add(kind); }
  }
  const summary = [...counts].map(([type, count]) => (type === "pending_change" && changeKinds.size ? `${type} (${[...changeKinds].join(", ")})` : `${type} ×${count}`)).join(" · ");
  const email = emailOf(turn);
  const base = { userId: turn.user, email, conversationId: turn.conversation_id };
  const events: OwnerEvent[] = [];

  if (wanted("chat")) {
    events.push({
      id: `chat-${turn.id}`,
      type: "chat",
      email,
      count: actions.length,
      date: turn.created,
      status: turn.status,
      excerpt: excerpt(result.reply),
      details: { ...base, turnId: turn.turn_id, ...(summary ? { actions: summary } : {}), ...(turn.error_code ? { errorCode: turn.error_code } : {}) },
    });
  }
  if (wanted("generated") && suggestions.length) {
    const messages = suggestions.flatMap((action) => (Array.isArray(action.messages) ? action.messages : []).map(asObject));
    const channels = [...new Set(messages.map((message) => str(message.channel, 20)).filter(Boolean))];
    const leadNames = [...new Set(suggestions.map((action) => str(action.leadName, 120)).filter(Boolean))];
    events.push({
      id: `generated-${turn.id}`,
      type: "generated",
      email,
      count: messages.length,
      date: turn.created,
      excerpt: excerpt(messages[0]?.text),
      details: { ...base, leadName: leadNames.join(", "), channels: channels.join(", "), messageCount: messages.length },
    });
  }
  return events;
}

function contactEvent(contact: ContactRow): OwnerEvent {
  return {
    id: `contact-${contact.id}`,
    type: "contact",
    email: emailOf(contact),
    count: 0,
    date: contact.created,
    status: contact.status,
    excerpt: excerpt(contact.message),
    details: {
      userId: contact.user,
      email: emailOf(contact),
      channel: contact.channel,
      leadName: str(contact.expand?.lead?.name, 300),
      leadId: contact.lead,
      contactedAt: contact.contacted_at,
      ...(contact.notes ? { notes: excerpt(contact.notes) } : {}),
    },
  };
}

function scheduledEvent(row: ScheduledRow): OwnerEvent {
  return {
    id: `scheduled-${row.id}`,
    type: "scheduled",
    email: emailOf(row),
    count: 0,
    date: row.created,
    status: row.status,
    excerpt: excerpt(row.body),
    details: {
      userId: row.user,
      email: emailOf(row),
      channel: row.channel,
      leadName: str(row.lead_name, 300),
      leadId: row.lead_id,
      recipient: str(row.recipient, 254),
      ...(row.subject ? { subject: str(row.subject, 200) } : {}),
      sendAt: row.send_at,
      ...(row.sent_at ? { sentAt: row.sent_at } : {}),
      ...(row.error ? { error: str(row.error, 80) } : {}),
    },
  };
}

/**
 * General activity feed, newest first. `?type=` narrows to one event type; `?page=N` (1..10) returns the N-th slice of 20.
 * Each source reads its `20 * page` newest rows (capped at 200), so the merged slice is exact without cursors. Read-only.
 * Sources fail independently: the response carries the rest plus `failedSources` (event types); 502 only when all fail.
 */
export async function GET(request: Request) {
  const t = errorTranslator(request);
  const denied = (await requireOwner(request)) ?? pocketBaseNotReady(request);
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const typeParam = params.get("type") ?? "";
  if (typeParam && !(eventTypes as readonly string[]).includes(typeParam)) return errorResponse(t("ownerInvalidData"), 400);
  const page = parsePage(params.get("page"));
  if (page === null) return errorResponse(t("invalidPage"), 400);
  const type = typeParam as EventType | "";
  const wanted = (candidate: EventType) => !type || type === candidate;
  const perPage = Math.min(limit * page, maxFetch);
  const base = { perPage, skipTotal: 1 } as const;
  const batchFilter = type === "leads" ? 'kind != "person"' : type === "people" ? 'kind = "person"' : "";

  // One bounded query per wanted source, all in parallel; relations come from `expand`, no per-row lookups.
  // `types` are the event types each source feeds, reported back in `failedSources` when it fails.
  // `size` is the number of rows the source returned (its quota check for `hasMore`).
  type Source = { name: string; types: EventType[]; run: () => Promise<{ events: OwnerEvent[]; size: number }> };
  const sources: Source[] = [];
  const add = (name: string, types: EventType[], run: Source["run"]) => {
    if (types.some(wanted)) sources.push({ name, types: types.filter(wanted), run });
  };

  add("users.signup", ["signup"], async () => {
    const { items } = await listSource<UserRow>("users", { ...base, sort: "-created", fields: "id,email,name,created" });
    return { size: items.length, events: items.map((user): OwnerEvent => ({
      id: `signup-${user.id}`, type: "signup", email: user.email, count: 0, date: user.created,
      details: { userId: user.id, email: user.email, name: user.name || "" },
    })) };
  });
  add("users.verified", ["verified"], async () => {
    const { items } = await listSource<UserRow>("users", {
      ...base,
      sort: "-welcome_email_sent_at",
      filter: 'verified = true && welcome_email_sent_at != ""',
      fields: "id,email,name,welcome_email_sent_at",
    });
    return { size: items.length, events: items.map((user): OwnerEvent => ({
      id: `verified-${user.id}`, type: "verified", email: user.email, count: 0, date: user.welcome_email_sent_at ?? "",
      details: { userId: user.id, email: user.email, name: user.name || "" },
    })) };
  });
  add("lead_batches", ["leads", "people"], async () => {
    const { items } = await listSource<BatchRow>("lead_batches", {
      ...base,
      sort: "-created_at",
      expand: "user",
      fields: `id,user,kind,query,keywords,country,province,district,requested_count,result_count,status,created_at,${userFields}`,
      ...(batchFilter ? { filter: batchFilter } : {}),
    });
    return { size: items.length, events: items.map(batchEvent).filter((event) => wanted(event.type)) };
  });
  add("leadtita_chat_turns", ["chat", "generated"], async () => {
    const { items } = await listSource<TurnRow>("leadtita_chat_turns", {
      ...base,
      sort: "-created",
      expand: "user",
      fields: `id,user,conversation_id,turn_id,status,result,error_code,created,${userFields}`,
      ...(type === "generated" ? { filter: 'status = "completed" && result ~ "message_suggestions"' } : {}),
    });
    return { size: items.length, events: items.flatMap((turn) => turnEvents(turn, wanted)) };
  });
  add("lead_contacts", ["contact"], async () => {
    const { items } = await listSource<ContactRow>("lead_contacts", {
      ...base,
      sort: "-created",
      expand: "user,lead",
      fields: `id,user,lead,channel,message:excerpt(${excerptLength * 2}),status,notes:excerpt(${excerptLength * 2}),contacted_at,created,${userFields},expand.lead.id,expand.lead.name`,
    });
    return { size: items.length, events: items.map(contactEvent) };
  });
  add("scheduled_messages", ["scheduled"], async () => {
    const { items } = await listSource<ScheduledRow>("scheduled_messages", {
      ...base,
      sort: "-created",
      expand: "user",
      fields: `id,user,channel,lead_id,lead_name,recipient,subject,body:excerpt(${excerptLength * 2}),send_at,status,error,sent_at,created,${userFields}`,
    });
    return { size: items.length, events: items.map(scheduledEvent) };
  });

  // allSettled: a missing collection, a rejected filter or a slow source drops only its own events.
  const settled = await Promise.allSettled(sources.map((source) => source.run()));
  const events: OwnerEvent[] = [];
  const failedSources: string[] = [];
  let sourceFull = false;
  settled.forEach((result, index) => {
    const source = sources[index];
    if (result.status === "fulfilled") {
      events.push(...result.value.events);
      // A source that filled its quota may hold older rows than the ones merged here.
      if (result.value.size >= perPage) sourceFull = true;
      return;
    }
    const error = result.reason;
    const status = error && typeof error === "object" && "status" in error ? ` ${String(error.status)}` : "";
    console.error(`Owner events source failed: ${source.name}${status}`, error instanceof Error ? error.name : "unknown");
    failedSources.push(...source.types);
  });

  if (sources.length > 0 && settled.every((result) => result.status === "rejected")) {
    return NextResponse.json({ error: t("ownerMetricsFailed"), failedSources }, { status: 502 });
  }

  const sorted = events.filter((event) => event.date).sort((a, b) => time(b.date) - time(a.date));
  const end = page * limit;
  const hasMore = page < maxPage && (sorted.length > end || sourceFull);
  return NextResponse.json({ items: sorted.slice(end - limit, end), hasMore, failedSources });
}
