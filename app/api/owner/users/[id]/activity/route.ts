import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/server/owner";
import { errorTranslator } from "@/lib/server/locale";
import { errorResponse, filterString, findUserSummary, isValidRecordId, listRecords, pocketBaseDate, pocketBaseNotReady } from "../../../_shared";
import { clip, excerpt, generatedGroups, ownedBy } from "./shared";

// Owner "Actividad" of one user: counts + newest-first lists with excerpts only. Full content lives behind the audited
// /conversations/[conversationId] and /messages/[kind]/[recordId] routes.

const sections = ["conversations", "generated", "contacts", "scheduled", "searches"] as const;
type Section = (typeof sections)[number];
type Page<T> = { items: T[]; page: number; totalPages: number; totalItems: number };

const perPage = 10;
const maxPage = 100;
const periodDays = 30;
const aiPageSize = 200;
const aiMaxPages = 10;

type ConversationRow = { id: string; title?: string; message_count?: number; last_message_at?: string; created: string; is_active?: boolean };
type TurnRow = { id: string; result?: unknown; created: string };
type ContactRow = { id: string; channel?: string; status?: string; message?: string; contacted_at?: string; created: string; expand?: { lead?: { name?: string } } };
type ScheduledRow = { id: string; channel?: string; recipient?: string; lead_name?: string; subject?: string; body?: string; send_at?: string; status?: string; error?: string; created: string };
type BatchRow = { id: string; kind?: string; keywords?: unknown; query?: string; country?: string; province?: string; district?: string; requested_count?: number; result_count?: number; status?: string; created_at?: string };
type GmailRow = { day?: string; used?: number };
type AiRow = { feature?: string; prompt_tokens?: number; completion_tokens?: number; cost_usd?: number };

const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const pageOf = <R, T>(result: Page<R>, map: (row: R) => T | T[]): Page<T> => ({
  items: result.items.flatMap((row) => map(row)),
  page: result.page,
  totalPages: result.totalPages,
  totalItems: result.totalItems,
});

function keywordsText(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item)).join(", ");
  return typeof value === "string" ? value : "";
}

const loaders: Record<Section, (userId: string, page: number) => Promise<Page<unknown>>> = {
  conversations: async (userId, page) => pageOf(
    await listRecords<ConversationRow>("leadtita_conversations", {
      page, perPage, filter: ownedBy(userId), sort: "-last_message_at,-created",
      fields: "id,title,message_count,last_message_at,created,is_active",
    }),
    (row) => ({ id: row.id, title: clip(row.title, 200), messageCount: num(row.message_count), lastMessageAt: row.last_message_at || row.created, archived: row.is_active === false }),
  ),
  // One page = turns with generated messages; each turn expands to one item per suggested message.
  generated: async (userId, page) => pageOf(
    await listRecords<TurnRow>("leadtita_chat_turns", {
      page, perPage, sort: "-created", fields: "id,result,created",
      filter: `${ownedBy(userId)} && status = "completed" && result ~ "message_suggestions"`,
    }),
    (row) => generatedGroups(row.result, 2000).flatMap((group, groupIndex) => group.messages.map((message, messageIndex) => ({
      id: row.id, key: `${row.id}:${groupIndex}:${messageIndex}`, leadName: group.leadName, channel: message.channel,
      subject: excerpt(message.subject, 120), excerpt: excerpt(message.text), date: row.created,
    }))),
  ),
  contacts: async (userId, page) => pageOf(
    await listRecords<ContactRow>("lead_contacts", {
      page, perPage, filter: ownedBy(userId), sort: "-created", expand: "lead",
      fields: "id,channel,status,contacted_at,created,message:excerpt(200,true),expand.lead.name",
    }),
    (row) => ({ id: row.id, leadName: clip(row.expand?.lead?.name, 255), channel: clip(row.channel, 40), status: clip(row.status, 40), excerpt: excerpt(row.message), date: row.contacted_at || row.created }),
  ),
  scheduled: async (userId, page) => pageOf(
    await listRecords<ScheduledRow>("scheduled_messages", {
      page, perPage, filter: ownedBy(userId), sort: "-send_at,-created",
      fields: "id,channel,recipient,lead_name,subject,body:excerpt(200,true),send_at,status,error,created",
    }),
    (row) => ({
      id: row.id, channel: row.channel === "email" ? "email" : "whatsapp", recipient: clip(row.recipient, 300), leadName: clip(row.lead_name, 300),
      subject: excerpt(row.subject, 120), excerpt: excerpt(row.body), sendAt: row.send_at || row.created, status: clip(row.status, 20), error: clip(row.error, 60),
    }),
  ),
  searches: async (userId, page) => pageOf(
    await listRecords<BatchRow>("lead_batches", {
      page, perPage, filter: ownedBy(userId), sort: "-created_at",
      fields: "id,kind,keywords,query,country,province,district,requested_count,result_count,status,created_at",
    }),
    (row) => ({
      id: row.id, kind: row.kind === "person" ? "person" : "business",
      query: excerpt(row.kind === "person" ? row.query : keywordsText(row.keywords) || row.query),
      area: [row.district, row.province, row.country].filter(Boolean).join(", ").slice(0, 200),
      requested: num(row.requested_count), results: num(row.result_count), status: clip(row.status, 20), date: row.created_at || "",
    }),
  ),
};

/** Gmail sends per day over the last 30 days (Buenos Aires day strings compare lexicographically). */
async function gmailUsage(userId: string, since: Date) {
  const day = since.toISOString().slice(0, 10);
  const result = await listRecords<GmailRow>("gmail_daily_usage", {
    perPage: periodDays + 1, skipTotal: 1, sort: "-day", fields: "day,used",
    filter: `${ownedBy(userId)} && day >= ${filterString(day)}`,
  });
  const days = result.items.map((row) => ({ day: clip(row.day, 10), used: num(row.used) })).filter((row) => row.used > 0);
  return { total: days.reduce((sum, row) => sum + row.used, 0), days };
}

/** AI usage over the last 30 days: exact call count, token/cost sums over at most 2,000 rows (`truncated` beyond that). */
async function aiUsage(userId: string, since: Date) {
  const filter = `${ownedBy(userId)} && created_at >= ${filterString(pocketBaseDate(since))}`;
  const params = { perPage: aiPageSize, filter, sort: "-created_at", fields: "feature,prompt_tokens,completion_tokens,cost_usd" };
  const first = await listRecords<AiRow>("ai_usage", { ...params, page: 1 });
  const rows = [...first.items];
  for (let page = 2; page <= Math.min(first.totalPages, aiMaxPages); page++) {
    rows.push(...(await listRecords<AiRow>("ai_usage", { ...params, page, skipTotal: 1 })).items);
  }
  const byFeature = new Map<string, { feature: string; calls: number; tokens: number; costUsd: number }>();
  let tokens = 0;
  let costUsd = 0;
  for (const row of rows) {
    const feature = clip(row.feature, 60) || "unknown";
    const rowTokens = num(row.prompt_tokens) + num(row.completion_tokens);
    const entry = byFeature.get(feature) ?? { feature, calls: 0, tokens: 0, costUsd: 0 };
    entry.calls += 1;
    entry.tokens += rowTokens;
    entry.costUsd += num(row.cost_usd);
    byFeature.set(feature, entry);
    tokens += rowTokens;
    costUsd += num(row.cost_usd);
  }
  return {
    calls: first.totalItems,
    tokens,
    costUsd,
    truncated: first.totalItems > rows.length,
    byFeature: [...byFeature.values()].sort((a, b) => b.costUsd - a.costUsd || b.calls - a.calls),
  };
}

/** Resolves to null instead of rejecting, so one missing source doesn't fail the whole view. */
const settle = <T,>(promise: Promise<T>) => promise.catch((error: unknown) => {
  console.error("Owner user activity source failed:", error instanceof Error ? error.name : "unknown");
  return null;
});

function parsePage(value: string | null) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.min(parsed, maxPage) : 1;
}

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const t = errorTranslator(request);
  const denied = (await requireOwner(request)) ?? pocketBaseNotReady(request);
  if (denied) return denied;
  const { id } = await context.params;
  if (!isValidRecordId(id)) return errorResponse(t("ownerUserNotFound"), 404);
  const params = new URL(request.url).searchParams;
  const noStore = { headers: { "Cache-Control": "no-store" } };

  const requested = params.get("section");
  if (requested !== null) {
    if (!sections.includes(requested as Section)) return errorResponse(t("ownerInvalidData"), 400);
    try {
      const [user, page] = await Promise.all([findUserSummary(id), loaders[requested as Section](id, parsePage(params.get("page")))]);
      if (!user) return errorResponse(t("ownerUserNotFound"), 404);
      return NextResponse.json({ section: requested, ...page }, noStore);
    } catch (error) {
      console.error("Owner user activity page failed:", error instanceof Error ? error.name : "unknown");
      return errorResponse(t("ownerUserLoadFailed"), 502);
    }
  }

  const since = new Date(Date.now() - periodDays * 86_400_000);
  try {
    // Independent bounded queries in parallel; a failing source is reported as unavailable instead of failing the view.
    const [user, gmail, ai, ...pages] = await Promise.all([
      findUserSummary(id),
      settle(gmailUsage(id, since)),
      settle(aiUsage(id, since)),
      ...sections.map((section) => settle(loaders[section](id, 1))),
    ]);
    if (!user) return errorResponse(t("ownerUserNotFound"), 404);
    const lists = Object.fromEntries(sections.map((section, index) => [section, pages[index] ?? null])) as Record<Section, Page<unknown> | null>;
    const unavailable = [
      ...sections.filter((section) => lists[section] === null),
      ...(gmail ? [] : ["gmail"]),
      ...(ai ? [] : ["ai"]),
    ];
    return NextResponse.json({
      user: { id: user.id, email: user.email },
      periodDays,
      summary: Object.fromEntries(sections.map((section) => [section, lists[section]?.totalItems ?? 0])),
      sections: lists,
      gmail,
      ai,
      unavailable,
    }, noStore);
  } catch (error) {
    console.error("Owner user activity failed:", error instanceof Error ? error.name : "unknown");
    return errorResponse(t("ownerUserLoadFailed"), 502);
  }
}
