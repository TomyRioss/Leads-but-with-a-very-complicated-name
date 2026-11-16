import { BLOG_LOCALES, BLOG_STATUSES, slugify, type BlogLocale, type BlogPost, type BlogPostInput, type BlogStatus } from "@/lib/blog";
import { BlogInputError, createPost, deletePost, getPostForOwner, updatePost } from "@/lib/server/blog";
import { getFeedbackIssue, isLinearConfigured } from "@/lib/server/linear";
import type { OwnerIdentity } from "@/lib/server/owner";
import {
  adjustOwnerUserCredits,
  closeOwnerFeedback,
  deleteOwnerBatch,
  deleteOwnerUser,
  FEEDBACK_REWARD_CREDITS,
  isValidCreditAmount,
  OWNER_SUBSCRIPTION_STATUSES,
  parseUserProfileChanges,
  setOwnerSubscriptionStatus,
  updateOwnerUserProfile,
  type OwnerActionResult,
  type OwnerSubscriptionStatus,
} from "@/lib/server/owner-actions";
import { requiresCard, signOwnerChange, type OwnerChangeArgs, type OwnerChangeKind, type OwnerPermission } from "@/lib/server/owner-assistant-policy";
import { pocketBaseFetch, PocketBaseRequestError } from "@/lib/server/pocketbase";
import { filterString, findUserSummary, isNotFound, isValidRecordId, maxCredits, normalizeCredits, type SubscriptionRecord } from "@/app/api/owner/_shared";

// Leadtita Staff tools. Reads go through the existing owner GET routes (same validation, owner check and response
// shape) with the owner's own cookie; writes only return signed proposals, executed later by the confirm endpoint.

export type OwnerInternalCall = { origin: string; cookie: string; locale: "es" | "en" };
/** One line on the Yes/No card. Values are display data (rendered as text), never instructions. */
export type OwnerCardField = { key: string; before?: string | number; after?: string | number };
export type OwnerPendingCard = { kind: OwnerChangeKind; target: string; fields: OwnerCardField[]; needsCard: boolean; destructive: boolean };
export type OwnerAssistantAction = { type: "pending_change"; token: string; change: OwnerPendingCard };

export type OwnerToolContext = {
  owner: OwnerIdentity;
  call: OwnerInternalCall;
  permission: OwnerPermission;
  actions: OwnerAssistantAction[];
  proposals: number;
};

const MAX_PROPOSALS_PER_TURN = 5;
const DEFAULT_PER_PAGE = 10;
const MAX_PER_PAGE = 25;
const API_TIMEOUT_MS = 20_000;
const BLOG_CONTENT_MAX = 30_000;
const BLOG_READ_MAX = 12_000;
const FEEDBACK_ID = /^[A-Za-z0-9-]{1,64}$/;

// ---------- Small validators ----------

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const clip = (value: unknown, max: number) => (typeof value === "string" ? value : value == null ? "" : String(value)).slice(0, max);
const optionalText = (value: unknown, max: number) => (value === undefined ? undefined : typeof value === "string" && value.trim().length <= max ? value.trim() : null);
const recordId = (value: unknown) => (typeof value === "string" && isValidRecordId(value) ? value : null);
const positive = (value: unknown, fallback: number, max: number) => (typeof value === "number" && Number.isInteger(value) && value >= 1 ? Math.min(value, max) : fallback);
const oneOf = <T extends string>(values: readonly T[], value: unknown) => ((values as readonly unknown[]).includes(value) ? (value as T) : undefined);

function query(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : "";
}

async function ownerApi<T>(ctx: OwnerToolContext, path: string): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const response = await fetch(new URL(path, ctx.call.origin), {
      headers: { Cookie: ctx.call.cookie, "Accept-Language": ctx.call.locale },
      cache: "no-store",
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    const payload = (await response.json().catch(() => null)) as (T & { error?: unknown }) | null;
    if (!response.ok || !payload) return { ok: false, error: `Request failed (${response.status})${typeof payload?.error === "string" ? `: ${payload.error.slice(0, 160)}` : ""}` };
    return { ok: true, data: payload };
  } catch (error) {
    console.error("Owner assistant read failed:", error instanceof Error ? error.name : "unknown");
    return { ok: false, error: "Request failed." };
  }
}

const listParams = (args: Record<string, unknown>) => ({
  page: positive(args.page, 1, 1000),
  perPage: positive(args.perPage, DEFAULT_PER_PAGE, MAX_PER_PAGE),
  q: typeof args.q === "string" ? args.q.trim().slice(0, 100) : undefined,
});
type Page<T> = { items: T[]; page: number; totalPages: number; totalItems?: number };
const pageInfo = <T>(result: Page<T>) => ({ page: result.page, totalPages: result.totalPages, ...(result.totalItems !== undefined ? { totalItems: result.totalItems } : {}) });

// ---------- Tool definitions (OpenAI function format) ----------

const fn = (name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []) => ({
  type: "function" as const,
  function: { name, description, parameters: { type: "object", additionalProperties: false, properties, required } },
});
const idProp = { type: "string", pattern: "^[A-Za-z0-9]{1,30}$" };
const pagingProps = {
  q: { type: "string", maxLength: 100, description: "Optional text filter." },
  page: { type: "integer", minimum: 1 },
  perPage: { type: "integer", minimum: 1, maximum: MAX_PER_PAGE },
};
const blogFields = {
  title: { type: "string", minLength: 1, maxLength: 160 },
  slug: { type: "string", maxLength: 120, description: "Optional; derived from the title when omitted." },
  locale: { type: "string", enum: BLOG_LOCALES },
  excerpt: { type: "string", maxLength: 300 },
  content: { type: "string", maxLength: BLOG_CONTENT_MAX, description: "Markdown body." },
  tags: { type: "array", maxItems: 12, items: { type: "string", maxLength: 40 } },
  status: { type: "string", enum: BLOG_STATUSES },
  seoTitle: { type: "string", maxLength: 70 },
  seoDescription: { type: "string", maxLength: 170 },
  authorName: { type: "string", maxLength: 80 },
};

export const ownerTools = [
  fn("get_overview", "Site KPIs: MRR, active/paused subscriptions, total and new users (30d), credits in circulation, revenue 30d, plan breakdown."),
  fn("get_recent_events", "Latest signups, email verifications and lead searches (20, newest first)."),
  fn("get_analytics", "Traffic (PostHog), feature usage, credits spent by feature and AI usage/cost (by feature, model and top users) for the last N days.", { days: { type: "integer", enum: [7, 30, 90] } }),
  fn("search_users", "List users (newest first) with credits, role, plan and last activity. q filters by email or name.", pagingProps),
  fn("get_user", "One user's detail: profile, credits, role, latest subscriptions and payments.", { userId: idProp }, ["userId"]),
  fn("list_subscriptions", "Subscriptions, newest first. q filters by user email.", { ...pagingProps, status: { type: "string", enum: ["authorized", "paused", "pending", "canceled", "cancelled", "rejected", "creating"] } }),
  fn("list_payments", "Subscription payments, newest first. q filters by user email.", { ...pagingProps, status: { type: "string", enum: ["processing", "processed", "approved", "pending", "rejected", "failed", "canceled", "cancelled", "refunded"] } }),
  fn("list_searches", "Lead search batches, newest first. q filters by user email.", { ...pagingProps, status: { type: "string", enum: ["running", "completed", "partial", "failed"] } }),
  fn("list_feedback", "User feedback (comments and bug reports). q filters by email, text or identifier.", { ...pagingProps, status: { type: "string", enum: ["open", "closed"] } }),
  fn("list_audit_log", "Owner audit log, newest first. q filters by target or actor.", { ...pagingProps, action: { type: "string", enum: ["user.credits_set", "user.credits_add", "user.update", "user.delete", "subscription.assign", "subscription.status", "subscription.plan", "batch.delete"] } }),
  fn("trace_timeline", "Per-user traceability timeline (50 per page): Leadtita conversations, emails, searches, people searches, AI usage, payments.", {
    user: { type: "string", maxLength: 100, description: "User id or email fragment. Omit for everyone." },
    types: { type: "array", items: { type: "string", enum: ["conversation", "email_sent", "email_system", "batch", "people_search", "ai_usage", "payment"] }, maxItems: 7 },
    from: { type: "string", maxLength: 30, description: "YYYY-MM-DD" },
    to: { type: "string", maxLength: 30, description: "YYYY-MM-DD" },
    page: { type: "integer", minimum: 1, maximum: 10 },
  }),
  fn("get_conversation", "One user's Leadtita conversation (latest 30 messages, tools and cards). Id from trace_timeline (conversation refId).", { conversationId: idProp }, ["conversationId"]),
  fn("list_blog_posts", "Blog posts, most recently updated first. q filters by title or slug.", { ...pagingProps, status: { type: "string", enum: BLOG_STATUSES } }),
  fn("get_blog_post", "One blog post with its content.", { postId: idProp }, ["postId"]),
  fn("propose_adjust_credits", "Propose setting (mode set) or adding/subtracting (mode add, negative to subtract) a user's credits, in 0.5 steps. Yes/No card.", {
    userId: idProp, mode: { type: "string", enum: ["set", "add"] }, amount: { type: "number" },
  }, ["userId", "mode", "amount"]),
  fn("propose_update_user", "Propose editing a user's name, email or phone (only the fields that change). Yes/No card.", {
    userId: idProp, name: { type: "string", maxLength: 100 }, email: { type: "string", maxLength: 200 }, phone: { type: "string", maxLength: 30 },
  }, ["userId"]),
  fn("propose_delete_user", "Propose deleting a user account and all its data (irreversible). Yes/No card.", { userId: idProp }, ["userId"]),
  fn("propose_subscription_status", "Propose changing a subscription status. Plans cannot be changed here (external billing). Yes/No card.", {
    subscriptionId: idProp, status: { type: "string", enum: OWNER_SUBSCRIPTION_STATUSES },
  }, ["subscriptionId", "status"]),
  fn("propose_close_feedback", `Propose closing a feedback item: marks it done, gives its author ${FEEDBACK_REWARD_CREDITS} credits and emails them a thank-you. Yes/No card.`, {
    feedbackId: { type: "string", pattern: FEEDBACK_ID.source },
  }, ["feedbackId"]),
  fn("propose_delete_batch", "Propose deleting a lead search batch and its leads (irreversible). Yes/No card.", { batchId: idProp }, ["batchId"]),
  fn("propose_create_blog_post", "Propose creating a blog post (draft unless the owner asked to publish). Yes/No card.", blogFields, ["title", "locale", "content", "status"]),
  fn("propose_update_blog_post", "Propose editing a blog post (only the fields that change). Call get_blog_post first. Yes/No card.", { postId: idProp, ...blogFields }, ["postId"]),
  fn("propose_delete_blog_post", "Propose deleting a blog post (irreversible). Yes/No card.", { postId: idProp }, ["postId"]),
];

// ---------- Reads ----------

type UserItem = { id: string; email: string; name: string; credits: number; created: string; role: string; lastActivity?: string; subscription?: { planId: string; status: string } | null };

async function read(ctx: OwnerToolContext, name: string, args: Record<string, unknown>): Promise<unknown> {
  const fail = (result: { ok: false; error: string }) => ({ error: result.error });
  if (name === "get_overview") {
    const result = await ownerApi<Record<string, unknown>>(ctx, "/api/owner/overview");
    return result.ok ? result.data : fail(result);
  }
  if (name === "get_recent_events") {
    const result = await ownerApi<{ items: { type: string; email: string; count: number; date: string; details: Record<string, unknown> }[] }>(ctx, "/api/owner/events");
    if (!result.ok) return fail(result);
    return { items: result.data.items.map((item) => ({ type: item.type, email: item.email, count: item.count, date: item.date, details: Object.fromEntries(Object.entries(item.details ?? {}).map(([key, value]) => [key, clip(value, 160)])) })) };
  }
  if (name === "get_analytics") {
    const days = args.days === 7 || args.days === 90 ? args.days : 30;
    type Analytics = { days: number; traffic: Record<string, unknown>; features: unknown[]; credits: unknown; ai: Record<string, unknown> };
    const result = await ownerApi<Analytics>(ctx, `/api/owner/analytics?days=${days}`);
    if (!result.ok) return fail(result);
    // Daily series are dropped: totals and top lists are enough for analysis and keep the context small.
    const { daily: _trafficDaily, ...traffic } = result.data.traffic ?? {};
    const { daily: _aiDaily, ...ai } = result.data.ai ?? {};
    void _trafficDaily; void _aiDaily;
    return { days: result.data.days, traffic, features: result.data.features, credits: result.data.credits, ai };
  }
  if (name === "search_users") {
    const { page, perPage, q } = listParams(args);
    const result = await ownerApi<Page<UserItem>>(ctx, `/api/owner/users${query({ page, perPage, q })}`);
    if (!result.ok) return fail(result);
    return {
      ...pageInfo(result.data),
      items: result.data.items.map((user) => ({ id: user.id, email: user.email, name: clip(user.name, 100), credits: user.credits, role: user.role, created: user.created, lastActivity: user.lastActivity ?? "", plan: user.subscription ? `${user.subscription.planId} (${user.subscription.status})` : "" })),
    };
  }
  if (name === "get_user") {
    const id = recordId(args.userId);
    if (!id) return { error: "Invalid userId." };
    type Detail = { user: Record<string, unknown>; subscriptions: Record<string, unknown>[]; payments: Record<string, unknown>[]; subscriptionsHasMore: boolean; paymentsHasMore: boolean };
    const result = await ownerApi<Detail>(ctx, `/api/owner/users/${id}`);
    if (!result.ok) return fail(result);
    return {
      user: result.data.user,
      subscriptions: result.data.subscriptions.slice(0, 10),
      payments: result.data.payments.slice(0, 10),
      moreHistory: result.data.subscriptions.length > 10 || result.data.payments.length > 10 || result.data.subscriptionsHasMore || result.data.paymentsHasMore,
    };
  }
  if (name === "list_subscriptions" || name === "list_payments" || name === "list_searches") {
    const { page, perPage, q } = listParams(args);
    const path = name === "list_subscriptions" ? "subscriptions" : name === "list_payments" ? "payments" : "batches";
    const status = typeof args.status === "string" ? args.status.slice(0, 20) : undefined;
    const result = await ownerApi<Page<Record<string, unknown>>>(ctx, `/api/owner/${path}${query({ page, perPage, q, status })}`);
    if (!result.ok) return fail(result);
    return { ...pageInfo(result.data), items: result.data.items.map((item) => (name === "list_searches" ? { ...item, keywords: clip(item.keywords, 200) } : item)) };
  }
  if (name === "list_feedback") {
    const { page, perPage, q } = listParams(args);
    const status = args.status === "open" || args.status === "closed" ? args.status : undefined;
    type Feedback = { id: string; identifier: string; createdAt: string; state: string; kind: string; message: string; user: { id: string; email: string } | null };
    const result = await ownerApi<Page<Feedback>>(ctx, `/api/owner/feedback${query({ page, perPage, q, status })}`);
    if (!result.ok) return fail(result);
    return {
      ...pageInfo(result.data),
      items: result.data.items.map((item) => ({ id: item.id, identifier: item.identifier, createdAt: item.createdAt, state: item.state, kind: item.kind, message: clip(item.message, 600), userId: item.user?.id ?? "", userEmail: item.user?.email ?? "" })),
    };
  }
  if (name === "list_audit_log") {
    const { page, perPage, q } = listParams(args);
    const action = typeof args.action === "string" ? args.action.slice(0, 40) : undefined;
    type Entry = { actorEmail: string; action: string; targetType: string; targetId: string; targetLabel: string; details: unknown; created: string };
    const result = await ownerApi<Page<Entry>>(ctx, `/api/owner/audit${query({ page, perPage, q, action })}`);
    if (!result.ok) return fail(result);
    return {
      ...pageInfo(result.data),
      items: result.data.items.map((entry) => ({ created: entry.created, actorEmail: entry.actorEmail, action: entry.action, targetType: entry.targetType, targetId: entry.targetId, targetLabel: clip(entry.targetLabel, 200), details: clip(JSON.stringify(entry.details ?? {}), 300) })),
    };
  }
  if (name === "trace_timeline") {
    const types = Array.isArray(args.types) ? args.types.filter((type): type is string => typeof type === "string").slice(0, 7).join(",") : undefined;
    const params = {
      user: typeof args.user === "string" ? args.user.trim().slice(0, 100) : undefined,
      types,
      from: typeof args.from === "string" ? args.from.slice(0, 30) : undefined,
      to: typeof args.to === "string" ? args.to.slice(0, 30) : undefined,
      page: positive(args.page, 1, 10),
    };
    type Trace = { type: string; at: string; userId: string; userEmail: string; title: string; summary: string; refId: string };
    const result = await ownerApi<Page<Trace> & { unavailable?: string[] }>(ctx, `/api/owner/traceability${query(params)}`);
    if (!result.ok) return fail(result);
    return {
      ...pageInfo(result.data),
      unavailable: result.data.unavailable ?? [],
      items: result.data.items.map((item) => ({ type: item.type, at: item.at, userEmail: item.userEmail, title: clip(item.title, 120), summary: clip(item.summary, 160), refId: item.refId })),
    };
  }
  if (name === "get_conversation") {
    const id = recordId(args.conversationId);
    if (!id) return { error: "Invalid conversationId." };
    type Message = { role: string; content: string; at: number | null; tools: string[]; cards: { kind: string; leadName: string; state: string; email?: { subject: string } }[] };
    const result = await ownerApi<{ userEmail: string; title: string; created: string; updated: string; messages: Message[] }>(ctx, `/api/owner/traceability/conversations/${id}`);
    if (!result.ok) return fail(result);
    const messages = result.data.messages;
    return {
      userEmail: result.data.userEmail,
      title: clip(result.data.title, 200),
      created: result.data.created,
      updated: result.data.updated,
      totalMessages: messages.length,
      // Card tokens and email bodies are never passed to the model.
      messages: messages.slice(-30).map((message) => ({
        role: message.role,
        at: message.at ? new Date(message.at).toISOString() : null,
        content: clip(message.content, 800),
        ...(message.tools?.length ? { tools: message.tools.slice(0, 10) } : {}),
        ...(message.cards?.length ? { cards: message.cards.slice(0, 5).map((card) => ({ kind: card.kind, leadName: clip(card.leadName, 120), state: card.state, ...(card.email ? { emailSubject: clip(card.email.subject, 160) } : {}) })) } : {}),
      })),
    };
  }
  if (name === "list_blog_posts") {
    const { page, perPage, q } = listParams(args);
    const status = args.status === "draft" || args.status === "published" ? args.status : undefined;
    const result = await ownerApi<Page<Omit<BlogPost, "content">>>(ctx, `/api/owner/blog${query({ page, perPage, q, status })}`);
    if (!result.ok) return fail(result);
    return { ...pageInfo(result.data), items: result.data.items.map((post) => ({ id: post.id, title: post.title, slug: post.slug, locale: post.locale, status: post.status, publishedAt: post.publishedAt, updated: post.updated, tags: post.tags, excerpt: clip(post.excerpt, 200) })) };
  }
  if (name === "get_blog_post") {
    const id = recordId(args.postId);
    if (!id) return { error: "Invalid postId." };
    const result = await ownerApi<{ post: BlogPost }>(ctx, `/api/owner/blog/${id}`);
    if (!result.ok) return fail(result);
    const { coverUrl: _coverUrl, content, ...post } = result.data.post;
    void _coverUrl;
    return { ...post, content: content.slice(0, BLOG_READ_MAX), contentTruncated: content.length > BLOG_READ_MAX, contentLength: content.length };
  }
  return undefined;
}

// ---------- Change arguments (validated identically when proposing and when confirming) ----------

type BlogArgs = Partial<BlogPostInput>;

/** Validates the editable blog fields; `requireCreate` demands title, locale, content and status. */
function blogInput(raw: Record<string, unknown>, requireCreate: boolean): BlogArgs | null {
  const out: BlogArgs = {};
  const texts: [keyof BlogArgs, number][] = [["title", 160], ["excerpt", 300], ["seoTitle", 70], ["seoDescription", 170], ["authorName", 80]];
  for (const [key, max] of texts) {
    const value = optionalText(raw[key], max);
    if (value === null) return null;
    if (value !== undefined) (out as Record<string, unknown>)[key] = value;
  }
  if (raw.content !== undefined) {
    if (typeof raw.content !== "string" || raw.content.length > BLOG_CONTENT_MAX) return null;
    out.content = raw.content;
  }
  if (raw.slug !== undefined) {
    const slug = typeof raw.slug === "string" ? slugify(raw.slug) : "";
    if (!slug) return null;
    out.slug = slug;
  }
  if (raw.locale !== undefined) { const locale = oneOf<BlogLocale>(BLOG_LOCALES, raw.locale); if (!locale) return null; out.locale = locale; }
  if (raw.status !== undefined) { const status = oneOf<BlogStatus>(BLOG_STATUSES, raw.status); if (!status) return null; out.status = status; }
  if (raw.tags !== undefined) {
    if (!Array.isArray(raw.tags) || raw.tags.length > 12 || raw.tags.some((tag) => typeof tag !== "string" || tag.length > 40)) return null;
    out.tags = raw.tags as string[];
  }
  if (requireCreate) {
    if (!out.title || !out.locale || !out.status || !out.content?.trim()) return null;
    out.slug ??= slugify(out.title);
    if (!out.slug) return null;
  }
  return out;
}

/** Normalizes the signed arguments of a change; null when anything is off. Runs at proposal and again at confirm. */
export function normalizeOwnerChange(kind: OwnerChangeKind, raw: OwnerChangeArgs): OwnerChangeArgs | null {
  if (!isObject(raw)) return null;
  const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value);
  switch (kind) {
    case "adjust_credits": {
      const userId = recordId(raw.userId);
      const mode = raw.mode === "set" || raw.mode === "add" ? raw.mode : null;
      if (!userId || !mode || !isValidCreditAmount(mode, raw.amount) || !finite(raw.expectBefore)) return null;
      return { userId, mode, amount: raw.amount, expectBefore: raw.expectBefore };
    }
    case "update_user": {
      const userId = recordId(raw.userId);
      if (!userId) return null;
      const fields = Object.fromEntries((["name", "email", "phone"] as const).filter((key) => raw[key] !== undefined).map((key) => [key, raw[key]]));
      const parsed = parseUserProfileChanges(fields);
      if (!parsed.ok || !Object.keys(parsed.value).length) return null;
      return { userId, ...parsed.value };
    }
    case "delete_user": {
      const userId = recordId(raw.userId);
      return userId && typeof raw.confirmEmail === "string" && raw.confirmEmail.length <= 200 ? { userId, confirmEmail: raw.confirmEmail } : null;
    }
    case "subscription_status": {
      const subscriptionId = recordId(raw.subscriptionId);
      const status = oneOf<OwnerSubscriptionStatus>(OWNER_SUBSCRIPTION_STATUSES, raw.status);
      return subscriptionId && status && typeof raw.expectBefore === "string" ? { subscriptionId, status, expectBefore: raw.expectBefore.slice(0, 30) } : null;
    }
    case "close_feedback":
      return typeof raw.feedbackId === "string" && FEEDBACK_ID.test(raw.feedbackId) ? { feedbackId: raw.feedbackId } : null;
    case "delete_batch": {
      const batchId = recordId(raw.batchId);
      return batchId ? { batchId } : null;
    }
    case "create_blog_post": {
      const input = blogInput(raw, true);
      return input ? { ...input } : null;
    }
    case "update_blog_post": {
      const postId = recordId(raw.postId);
      const { postId: _postId, expectUpdated, live, ...fields } = raw;
      void _postId;
      const input = blogInput(fields, false);
      if (!postId || !input || !Object.keys(input).length || typeof expectUpdated !== "string" || typeof live !== "boolean") return null;
      return { postId, expectUpdated, live, ...input };
    }
    case "delete_blog_post": {
      const postId = recordId(raw.postId);
      return postId && typeof raw.expectUpdated === "string" ? { postId, expectUpdated: raw.expectUpdated } : null;
    }
  }
}

// ---------- Proposals ----------

function propose(ctx: OwnerToolContext, kind: OwnerChangeKind, rawArgs: OwnerChangeArgs, card: { target: string; fields: OwnerCardField[]; destructive?: boolean }) {
  if (ctx.proposals >= MAX_PROPOSALS_PER_TURN) return { error: "Too many changes in one turn; ask the owner to confirm these first." };
  const args = normalizeOwnerChange(kind, rawArgs);
  if (!args) return { error: "Invalid arguments." };
  ctx.proposals += 1;
  const token = signOwnerChange({ uid: ctx.owner.id, kind, args, perm: ctx.permission });
  const needsCard = requiresCard(kind, args);
  ctx.actions.push({ type: "pending_change", token, change: { kind, target: clip(card.target, 200), fields: card.fields, needsCard, destructive: Boolean(card.destructive) } });
  const autoRun = ctx.permission === "danger" || (ctx.permission === "skip" && !needsCard);
  return { proposed: true, note: autoRun ? "The app runs it now. Reply with one short line saying what you are doing." : "Shown as a Yes/No card. Reply with one short line asking to confirm." };
}

type UserRow = { id: string; email: string; name?: string; credits?: number; role?: string; phone?: string };
const loadUser = async (id: string) => {
  try {
    return await pocketBaseFetch<UserRow>(`/api/collections/users/records/${id}?fields=id,email,name,credits,role,phone`);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
};

async function proposeChange(ctx: OwnerToolContext, name: string, args: Record<string, unknown>): Promise<unknown> {
  if (name === "propose_adjust_credits") {
    const userId = recordId(args.userId);
    const mode = args.mode === "set" || args.mode === "add" ? args.mode : null;
    if (!userId || !mode || !isValidCreditAmount(mode, args.amount)) return { error: "Invalid userId, mode or amount (0.5 steps; set must be >= 0)." };
    const user = await loadUser(userId);
    if (!user) return { error: "User not found." };
    const before = normalizeCredits(user.credits);
    const after = mode === "set" ? args.amount : before + args.amount;
    if (after < 0 || after > maxCredits) return { error: `The resulting balance must be between 0 and ${maxCredits}.` };
    return propose(ctx, "adjust_credits", { userId, mode, amount: args.amount, expectBefore: before }, {
      target: user.email,
      fields: [{ key: "credits", before, after }, ...(mode === "add" ? [{ key: "delta", after: args.amount > 0 ? `+${args.amount}` : String(args.amount) }] : [])],
    });
  }

  if (name === "propose_update_user") {
    const userId = recordId(args.userId);
    if (!userId) return { error: "Invalid userId." };
    const parsed = parseUserProfileChanges(Object.fromEntries((["name", "email", "phone"] as const).filter((key) => args[key] !== undefined).map((key) => [key, args[key]])));
    if (!parsed.ok) return { error: `Invalid ${parsed.error === "invalidEmail" ? "email" : parsed.error === "ownerPhoneFormat" ? "phone (digits, + ( ) . - and spaces, max 30)" : "name (max 100)"}.` };
    const user = await loadUser(userId);
    if (!user) return { error: "User not found." };
    const current: Record<string, string> = { name: user.name || "", email: user.email, phone: user.phone || "" };
    const changed = Object.entries(parsed.value).filter(([field, value]) => value !== current[field]);
    if (!changed.length) return { error: "Nothing would change." };
    if (changed.some(([field]) => field === "email") && (user.role === "owner" || user.id === ctx.owner.id)) return { error: "The owner account email cannot be changed here." };
    return propose(ctx, "update_user", { userId, ...Object.fromEntries(changed) }, {
      target: user.email,
      fields: changed.map(([key, after]) => ({ key, before: current[key], after })),
    });
  }

  if (name === "propose_delete_user") {
    const userId = recordId(args.userId);
    if (!userId) return { error: "Invalid userId." };
    const user = await loadUser(userId);
    if (!user) return { error: "User not found." };
    if (user.role === "owner" || user.id === ctx.owner.id) return { error: "Owner accounts cannot be deleted." };
    return propose(ctx, "delete_user", { userId, confirmEmail: user.email }, {
      target: user.email,
      destructive: true,
      fields: [{ key: "name", after: user.name || "—" }, { key: "credits", after: normalizeCredits(user.credits) }],
    });
  }

  if (name === "propose_subscription_status") {
    const subscriptionId = recordId(args.subscriptionId);
    const status = oneOf<OwnerSubscriptionStatus>(OWNER_SUBSCRIPTION_STATUSES, args.status);
    if (!subscriptionId || !status) return { error: "Invalid subscriptionId or status (authorized, paused, cancelled)." };
    let subscription: SubscriptionRecord;
    try {
      subscription = await pocketBaseFetch<SubscriptionRecord>(`/api/collections/subscriptions/records/${subscriptionId}`);
    } catch (error) {
      if (isNotFound(error)) return { error: "Subscription not found." };
      throw error;
    }
    const stored = status === "cancelled" ? "canceled" : status;
    if (subscription.status === stored) return { error: "The subscription already has that status." };
    const account = await findUserSummary(subscription.user).catch(() => null);
    return propose(ctx, "subscription_status", { subscriptionId, status, expectBefore: subscription.status }, {
      target: `${account?.email ?? subscription.user} · ${subscription.plan_id}`,
      fields: [{ key: "status", before: subscription.status, after: stored }],
    });
  }

  if (name === "propose_close_feedback") {
    if (!isLinearConfigured()) return { error: "Feedback (Linear) is not configured." };
    const feedbackId = typeof args.feedbackId === "string" && FEEDBACK_ID.test(args.feedbackId) ? args.feedbackId : null;
    if (!feedbackId) return { error: "Invalid feedbackId." };
    const feedback = await getFeedbackIssue(feedbackId);
    if (!feedback?.user) return { error: "Feedback not found." };
    if (feedback.state === "closed") return { error: "That feedback is already closed." };
    const account = await findUserSummary(feedback.user.id).catch(() => null);
    if (!account) return { error: "The author's account no longer exists." };
    return propose(ctx, "close_feedback", { feedbackId: feedback.id }, {
      target: feedback.identifier,
      fields: [{ key: "author", after: account.email }, { key: "reward", after: `+${FEEDBACK_REWARD_CREDITS}` }, { key: "message", after: clip(feedback.message, 240) }],
    });
  }

  if (name === "propose_delete_batch") {
    const batchId = recordId(args.batchId);
    if (!batchId) return { error: "Invalid batchId." };
    type Batch = { user?: string; keywords?: unknown; country?: string; province?: string; district?: string; status?: string; result_count?: number };
    let batch: Batch;
    try {
      batch = await pocketBaseFetch<Batch>(`/api/collections/lead_batches/records/${batchId}?fields=user,keywords,country,province,district,status,result_count`);
    } catch (error) {
      if (isNotFound(error)) return { error: "Search not found." };
      throw error;
    }
    if (batch.status === "running") return { error: "That search is still running; it cannot be deleted yet." };
    const account = batch.user ? await findUserSummary(batch.user).catch(() => null) : null;
    const keywords = Array.isArray(batch.keywords) ? batch.keywords.map(String).join(", ") : clip(batch.keywords, 200);
    return propose(ctx, "delete_batch", { batchId }, {
      target: clip(keywords, 200) || batchId,
      destructive: true,
      fields: [
        { key: "owner", after: account?.email ?? "—" },
        { key: "zone", after: [batch.district, batch.province, batch.country].filter(Boolean).join(", ") || "—" },
        { key: "leads", after: Number(batch.result_count) || 0 },
      ],
    });
  }

  if (name === "propose_create_blog_post") {
    const input = blogInput(args, true);
    if (!input) return { error: "Invalid post: title, locale, content and status are required; check the field limits." };
    return propose(ctx, "create_blog_post", { ...input }, {
      target: input.title ?? "",
      fields: [
        { key: "status", after: input.status ?? "draft" },
        { key: "locale", after: input.locale ?? "es" },
        { key: "slug", after: input.slug ?? "" },
        ...(input.excerpt ? [{ key: "excerpt", after: input.excerpt }] : []),
        { key: "contentLength", after: input.content?.length ?? 0 },
      ],
    });
  }

  if (name === "propose_update_blog_post" || name === "propose_delete_blog_post") {
    const postId = recordId(args.postId);
    if (!postId) return { error: "Invalid postId." };
    const post = await getPostForOwner(postId);
    if (!post) return { error: "Post not found." };
    if (name === "propose_delete_blog_post") {
      return propose(ctx, "delete_blog_post", { postId, expectUpdated: post.updated }, {
        target: post.title, destructive: true, fields: [{ key: "status", after: post.status }, { key: "slug", after: post.slug }],
      });
    }
    const { postId: _postId, ...fields } = args;
    void _postId;
    const input = blogInput(fields, false);
    if (!input) return { error: "Invalid fields; check the field limits." };
    const changes = Object.entries(input).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify((post as unknown as Record<string, unknown>)[key]));
    if (!changes.length) return { error: "Nothing would change." };
    const shown = (key: string, value: unknown) => (key === "content" ? `${String(value ?? "").length} chars` : Array.isArray(value) ? value.join(", ") : clip(value, 240));
    return propose(ctx, "update_blog_post", { postId, expectUpdated: post.updated, live: post.status === "published", ...Object.fromEntries(changes) }, {
      target: post.title,
      fields: changes.map(([key, value]) => ({ key, before: shown(key, (post as unknown as Record<string, unknown>)[key]), after: shown(key, value) })),
    });
  }
  return undefined;
}

export async function runOwnerTool(ctx: OwnerToolContext, name: string, rawArgs: string): Promise<unknown> {
  let args: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(rawArgs || "{}");
    if (!isObject(parsed)) return { error: "Arguments must be a JSON object." };
    args = parsed;
  } catch {
    return { error: "Invalid JSON arguments." };
  }
  if (name.startsWith("propose_")) return (await proposeChange(ctx, name, args)) ?? { error: `Unknown tool ${name}.` };
  const result = await read(ctx, name, args);
  // Database content is framed as data so text inside it is never mistaken for instructions.
  return result === undefined ? { error: `Unknown tool ${name}.` } : isObject(result) && typeof result.error === "string" ? result : { untrusted_data: result };
}

// ---------- Execution (confirm endpoint) ----------

export type OwnerChangeSummary = Record<string, string | number | boolean>;

/** Executes a verified, re-normalized change through the same domain functions as the owner routes (which audit it). */
export async function applyOwnerChange(request: Request, owner: OwnerIdentity, kind: OwnerChangeKind, args: OwnerChangeArgs): Promise<OwnerActionResult<OwnerChangeSummary>> {
  const done = <T extends OwnerChangeSummary>(result: OwnerActionResult<T>): OwnerActionResult<OwnerChangeSummary> => result;
  switch (kind) {
    case "adjust_credits":
      return done(await adjustOwnerUserCredits(request, owner, String(args.userId), args.mode === "set" ? "set" : "add", Number(args.amount), { expectBefore: Number(args.expectBefore) }));
    case "update_user": {
      const { userId, ...changes } = args;
      const result = await updateOwnerUserProfile(request, owner, String(userId), changes as { name?: string; email?: string; phone?: string });
      return result.ok ? { ok: true, value: { updated: Object.keys(result.value).join(",") } } : result;
    }
    case "delete_user":
      return done(await deleteOwnerUser(request, owner, String(args.userId), String(args.confirmEmail)));
    case "subscription_status":
      return done(await setOwnerSubscriptionStatus(request, owner, String(args.subscriptionId), args.status as OwnerSubscriptionStatus, { expectBefore: String(args.expectBefore) }));
    case "close_feedback":
      if (!isLinearConfigured()) return { ok: false, status: 503, error: "linearNotConfigured" };
      return done(await closeOwnerFeedback(request, owner, String(args.feedbackId)));
    case "delete_batch":
      return done(await deleteOwnerBatch(request, owner, String(args.batchId)));
    case "create_blog_post":
    case "update_blog_post":
    case "delete_blog_post":
      return applyBlogChange(kind, args);
  }
}

/** Same lib/server/blog functions as the owner blog routes (which do not write audit entries). */
async function applyBlogChange(kind: "create_blog_post" | "update_blog_post" | "delete_blog_post", args: OwnerChangeArgs): Promise<OwnerActionResult<OwnerChangeSummary>> {
  try {
    if (kind === "create_blog_post") {
      const input = args as unknown as BlogPostInput;
      // The slug is signed into the card: if a post already uses it, this card was already applied (or collides).
      const existing = await pocketBaseFetch<{ items: unknown[] }>(`/api/collections/blog_posts/records?${new URLSearchParams({ perPage: "1", skipTotal: "1", fields: "id", filter: `locale = ${filterString(input.locale)} && slug = ${filterString(input.slug ?? "")}` })}`);
      if (existing.items.length) return { ok: false, status: 409, error: "generic", code: "stale" };
      const post = await createPost(input);
      return { ok: true, value: { postId: post.id, slug: post.slug, status: post.status } };
    }
    const postId = String(args.postId);
    const current = await getPostForOwner(postId);
    if (!current) return { ok: false, status: 404, error: "ownerInvalidData" };
    if (current.updated !== args.expectUpdated) return { ok: false, status: 409, error: "generic", code: "stale" };
    if (kind === "delete_blog_post") {
      await deletePost(postId);
      return { ok: true, value: { postId } };
    }
    const { postId: _postId, expectUpdated: _expect, live: _live, ...input } = args;
    void _postId; void _expect; void _live;
    const post = await updatePost(postId, input as Partial<BlogPostInput>);
    return { ok: true, value: { postId: post.id, slug: post.slug, status: post.status } };
  } catch (error) {
    if (error instanceof BlogInputError) return { ok: false, status: error.field === "id" ? 404 : 400, error: "ownerInvalidData" };
    if (error instanceof PocketBaseRequestError && error.status === 404) return { ok: false, status: 404, error: "ownerInvalidData" };
    console.error("Owner assistant blog change failed:", error instanceof Error ? error.name : "unknown");
    return { ok: false, status: 502, error: "generic" };
  }
}
