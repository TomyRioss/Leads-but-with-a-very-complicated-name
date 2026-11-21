// Leadtita conversations stored server-side (collection leadtita_conversations, superuser only).
// Every query is scoped to the session user id passed by the route; ids from the request body are never trusted as owner.
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server/auth";
import { PocketBaseRequestError, isPocketBaseConfigured, pocketBaseFetch } from "@/lib/server/pocketbase";

const COLLECTION = "leadtita_conversations";
export const MAX_LISTED_CONVERSATIONS = 30;
export const MAX_STORED_MESSAGES = 200;
export const MAX_TITLE_LENGTH = 200;
// Collection json maxSize (bytes).
const MAX_MESSAGES_BYTES = 2_000_000;
const MAX_EXTRA_BYTES = 500_000;
const CLIENT_ID = /^[A-Za-z0-9_-]{1,64}$/;

export type ConversationSummary = { id: string; title: string; updatedAt: number; messageCount: number };
export type StoredServerConversation = { id: string; title: string; updatedAt: number; messages: unknown[]; extra?: unknown };

type Row = { id: string; client_id: string; is_active?: boolean; title?: string; messages?: unknown; extra?: unknown; message_count?: number; last_message_at?: string; updated?: string };

export class ConversationTooLargeError extends Error {
  constructor() {
    super("Conversation state is too large.");
    this.name = "ConversationTooLargeError";
  }
}

export const isClientId = (value: unknown): value is string => typeof value === "string" && CLIENT_ID.test(value);

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value ?? null), "utf8");

/**
 * Validates an incoming conversation: keeps the last 200 messages and drops the oldest until they fit the 2 MB column.
 * Returns null when the shape is wrong; throws ConversationTooLargeError when `extra` exceeds its 500 KB column.
 */
export function cleanConversation(input: unknown, now = Date.now()): StoredServerConversation | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Record<string, unknown>;
  if (!isClientId(value.id) || !Array.isArray(value.messages)) return null;
  const messages = value.messages.slice(-MAX_STORED_MESSAGES);
  let size = bytes(messages);
  while (size > MAX_MESSAGES_BYTES && messages.length) size -= bytes(messages.shift()) + 1;
  if (!messages.length) return null;
  const extra = value.extra && typeof value.extra === "object" && !Array.isArray(value.extra) ? value.extra : {};
  if (bytes(extra) > MAX_EXTRA_BYTES) throw new ConversationTooLargeError();
  const updatedAt = typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt) ? Math.min(value.updatedAt, now) : now;
  const title = typeof value.title === "string" ? value.title.trim().slice(0, MAX_TITLE_LENGTH) : "";
  return { id: value.id, title, updatedAt, messages, extra };
}

const quote = (value: string) => JSON.stringify(value);
const pbDate = (ms: number) => new Date(ms).toISOString().replace("T", " ");
const parseDate = (value?: string) => (value ? Date.parse(value.replace(" ", "T")) || 0 : 0);
const records = `/api/collections/${COLLECTION}/records`;
const recordPath = (id: string) => `${records}/${encodeURIComponent(id)}`;
const ownerFilter = (userId: string, clientId: string) => `user = ${quote(userId)} && client_id = ${quote(clientId)}`;

async function findRow(userId: string, clientId: string, fields: string): Promise<Row | null> {
  const result = await pocketBaseFetch<{ items: Row[] }>(
    `${records}?${new URLSearchParams({ filter: ownerFilter(userId, clientId), perPage: "1", skipTotal: "1", fields })}`,
  );
  return result.items[0] ?? null;
}

const updatedAtOf = (row: Row) => parseDate(row.last_message_at) || parseDate(row.updated);

/** Owner assistant (Leadtita Staff) chats share this collection; their client ids start with this prefix. */
export const STAFF_CLIENT_PREFIX = "staff-";

/** Newest first, at most 30, without messages. `staff` lists the owner assistant's chats; the default excludes them. */
export async function listConversations(userId: string, scope: "user" | "staff" = "user"): Promise<ConversationSummary[]> {
  const result = await pocketBaseFetch<{ items: Row[] }>(`${records}?${new URLSearchParams({
    filter: `user = ${quote(userId)} && is_active = true && client_id ${scope === "staff" ? "~" : "!~"} ${quote(`${STAFF_CLIENT_PREFIX}%`)}`,
    sort: "-last_message_at",
    perPage: String(MAX_LISTED_CONVERSATIONS),
    skipTotal: "1",
    fields: "client_id,title,message_count,last_message_at,updated",
  })}`);
  return result.items.map((row) => ({ id: row.client_id, title: row.title ?? "", updatedAt: updatedAtOf(row), messageCount: row.message_count ?? 0 }));
}

export async function getConversation(userId: string, clientId: string): Promise<StoredServerConversation | null> {
  if (!isClientId(clientId)) return null;
  const row = await findRow(userId, clientId, "client_id,is_active,title,messages,extra,last_message_at,updated");
  if (!row || row.is_active === false) return null;
  return { id: row.client_id, title: row.title ?? "", updatedAt: updatedAtOf(row), messages: Array.isArray(row.messages) ? row.messages : [], extra: row.extra ?? {} };
}

/** True only for a server record that was explicitly marked inactive. New unsaved chats remain usable. */
export async function isConversationInactive(userId: string, clientId: string): Promise<boolean> {
  if (!isClientId(clientId)) return true;
  const row = await findRow(userId, clientId, "is_active");
  return row?.is_active === false;
}

/** Insert or replace by (user, client_id). One retry covers two tabs creating the same conversation at once. */
export async function upsertConversation(userId: string, conversation: StoredServerConversation): Promise<boolean> {
  const fields = {
    user: userId,
    client_id: conversation.id,
    title: conversation.title,
    messages: conversation.messages,
    extra: conversation.extra ?? {},
    message_count: conversation.messages.length,
    last_message_at: pbDate(conversation.updatedAt),
  };
  const body = JSON.stringify(fields);
  const createBody = JSON.stringify({ ...fields, is_active: true });
  for (let attempt = 0; ; attempt++) {
    const existing = await findRow(userId, conversation.id, "id,is_active");
    if (existing?.is_active === false) return false;
    try {
      // is_active is a required bool in PocketBase (required bool = must be true): a create without it fails validation.
      await pocketBaseFetch(existing ? recordPath(existing.id) : records, { method: existing ? "PATCH" : "POST", body: existing ? body : createBody });
      return true;
    } catch (error) {
      // Unique (user, client_id) violation: the row appeared between find and create; retry as an update.
      if (attempt || existing || !(error instanceof PocketBaseRequestError) || error.status !== 400) throw error;
    }
  }
}

export async function deactivateConversations(userId: string, clientIds: string[]): Promise<void> {
  const ids = [...new Set(clientIds)].filter(isClientId);
  if (!ids.length) return;
  const filter = ids.map((id) => `client_id = ${quote(id)}`).join(" || ");
  const result = await pocketBaseFetch<{ items: Row[] }>(`${records}?${new URLSearchParams({
    filter: `user = ${quote(userId)} && is_active = true && (${filter})`,
    perPage: String(ids.length),
    skipTotal: "1",
    fields: "id",
  })}`);
  for (let offset = 0; offset < result.items.length; offset += 5) {
    await Promise.all(result.items.slice(offset, offset + 5).map((row) => pocketBaseFetch(recordPath(row.id), {
      method: "PATCH",
      body: JSON.stringify({ is_active: false }),
    })));
  }
}

// ---------- Route helpers (shared by /api/leadtita/conversations and /[id]) ----------

export const conversationJson = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Session user id, or a ready error response. */
export async function sessionUserId(request: Request): Promise<string | NextResponse> {
  if (!isPocketBaseConfigured()) return conversationJson({ error: "not_configured" }, 503);
  try {
    const session = await getCurrentUser(request);
    return session ? String(session.user.id) : conversationJson({ error: "unauthorized" }, 401);
  } catch {
    return conversationJson({ error: "unavailable" }, 503);
  }
}

/** Mutations only from this site (CSRF defense on top of SameSite=Lax). */
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin || origin === process.env.APP_URL?.trim().replace(/\/$/, "");
}
