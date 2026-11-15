"use client";

// Leadtita conversations: the server (/api/leadtita/conversations) is the source of truth; localStorage is a per-user
// cache (one entry per user id so accounts sharing a browser never mix) that restores instantly and works offline.
// Every storage access is guarded; when storage is unavailable or full, a per-tab memory copy keeps the session working.
// Network errors never break the chat: the conversation stays local and the next save retries.

export const MAX_CONVERSATIONS = 30;
export const MAX_STORED_MESSAGES = 200;
const PREFIX = "leadta:leadtita-history:";

export type StoredConversation<Message = unknown, Extra = unknown> = {
  id: string;
  title: string;
  updatedAt: number;
  messages: Message[];
  /** UI state that must survive a reload: card states, result-card states, per-lead analysis. */
  extra?: Extra;
};
export type LeadtitaHistory<Message = unknown, Extra = unknown> = { activeId: string | null; conversations: StoredConversation<Message, Extra>[] };

const memory = new Map<string, string>();
const keyFor = (userId: string) => `${PREFIX}${userId}`;

function read(key: string): string | null {
  try {
    const value = window.localStorage.getItem(key);
    if (value !== null) return value;
  } catch {
    // Private mode or blocked storage: fall through to memory.
  }
  return memory.get(key) ?? null;
}

function write(key: string, value: string) {
  memory.set(key, value);
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Quota or blocked storage: the memory copy keeps this tab working.
  }
}

export function newConversationId() {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Newest first, capped to 30 conversations of 200 messages; malformed data reads as empty. */
export function loadHistory<Message, Extra>(userId: string): LeadtitaHistory<Message, Extra> {
  try {
    const parsed = JSON.parse(read(keyFor(userId)) ?? "null") as LeadtitaHistory<Message, Extra> | null;
    if (!parsed || !Array.isArray(parsed.conversations)) return { activeId: null, conversations: [] };
    const conversations = parsed.conversations
      .filter((conversation) => conversation && typeof conversation.id === "string" && Array.isArray(conversation.messages))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_CONVERSATIONS);
    return { activeId: typeof parsed.activeId === "string" ? parsed.activeId : null, conversations };
  } catch {
    return { activeId: null, conversations: [] };
  }
}

function save<Message, Extra>(userId: string, history: LeadtitaHistory<Message, Extra>) {
  const conversations = [...history.conversations]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_CONVERSATIONS)
    .map((conversation) => ({ ...conversation, messages: conversation.messages.slice(-MAX_STORED_MESSAGES) }));
  write(keyFor(userId), JSON.stringify({ activeId: history.activeId, conversations }));
}

/** Insert or replace a conversation and make it the active one. */
export function saveConversation<Message, Extra>(userId: string, conversation: StoredConversation<Message, Extra>) {
  const history = loadHistory<Message, Extra>(userId);
  const others = history.conversations.filter((item) => item.id !== conversation.id);
  save(userId, { activeId: conversation.id, conversations: conversation.messages.length ? [conversation, ...others] : others });
}

export function setActiveConversation(userId: string, activeId: string | null) {
  save(userId, { ...loadHistory(userId), activeId });
}

export function deleteConversation(userId: string, id: string) {
  const history = loadHistory(userId);
  save(userId, { activeId: history.activeId === id ? null : history.activeId, conversations: history.conversations.filter((item) => item.id !== id) });
}

// ───────── Server sync ─────────

const API = "/api/leadtita/conversations";
const SAVE_DELAY_MS = 1500;
// Browsers cap keepalive bodies at 64 KB; bigger saves go as a normal request.
const KEEPALIVE_MAX_BYTES = 60_000;

export type ConversationSummary = { id: string; title: string; updatedAt: number };
/** History list entry: local and/or server copy; `serverUpdatedAt` is set when the server has it. */
export type HistoryItem = ConversationSummary & { serverUpdatedAt?: number };
type SyncState = { hashes: Record<string, string>; migrated?: boolean };

const syncKey = (userId: string) => `${PREFIX}${userId}:synced`;

function readSync(userId: string): SyncState {
  try {
    const parsed = JSON.parse(read(syncKey(userId)) ?? "null") as SyncState | null;
    return parsed && parsed.hashes && typeof parsed.hashes === "object" ? parsed : { hashes: {} };
  } catch {
    return { hashes: {} };
  }
}

function updateSync(userId: string, change: (state: SyncState) => void) {
  const state = readSync(userId);
  change(state);
  write(syncKey(userId), JSON.stringify(state));
}

/** FNV-1a of the content that matters (not updatedAt): unchanged conversations are never re-sent. */
function contentHash(conversation: StoredConversation) {
  const text = JSON.stringify([conversation.title, conversation.messages.slice(-MAX_STORED_MESSAGES), conversation.extra ?? null]);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
  return `${(hash >>> 0).toString(36)}:${text.length}`;
}

// One request at a time, in order: a slow save never lands after a newer one.
let queue: Promise<unknown> = Promise.resolve();
let pending: { userId: string; conversation: StoredConversation } | null = null;
let timer: number | undefined;
let listening = false;

async function push(userId: string, conversation: StoredConversation, keepalive = false): Promise<boolean> {
  // The tab switched accounts since this save was scheduled: never write one user's chat into another account.
  if (read(OWNER_KEY) !== userId) return false;
  const hash = contentHash(conversation);
  if (readSync(userId).hashes[conversation.id] === hash) return true;
  const body = JSON.stringify({ conversation: { ...conversation, messages: conversation.messages.slice(-MAX_STORED_MESSAGES) } });
  try {
    const response = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: keepalive && body.length < KEEPALIVE_MAX_BYTES });
    if (!response.ok) return false;
  } catch {
    return false;
  }
  updateSync(userId, (state) => { state.hashes[conversation.id] = hash; });
  return true;
}

function enqueue(task: () => Promise<boolean>): Promise<boolean> {
  const run = queue.then(task, task);
  queue = run;
  return run;
}

/** Sends the pending save now (keepalive when the tab is being hidden). */
export function flushServerSave(keepalive = false) {
  window.clearTimeout(timer);
  const next = pending;
  pending = null;
  if (next) void enqueue(() => push(next.userId, next.conversation, keepalive));
}

/** Debounced (~1.5 s) upload of the latest state; flushed when the tab is hidden. */
export function scheduleServerSave<Message, Extra>(userId: string, conversation: StoredConversation<Message, Extra>) {
  if (!conversation.messages.length) return;
  pending = { userId, conversation };
  window.clearTimeout(timer);
  timer = window.setTimeout(() => flushServerSave(), SAVE_DELAY_MS);
  if (listening) return;
  listening = true;
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushServerSave(true); });
  window.addEventListener("pagehide", () => flushServerSave(true));
}

/** Server list (newest first, no messages); null when the server can't be reached. */
export async function fetchConversationList(): Promise<ConversationSummary[] | null> {
  try {
    const response = await fetch(API, { cache: "no-store" });
    if (!response.ok) return null;
    const payload = await response.json() as { conversations?: ConversationSummary[] };
    return Array.isArray(payload.conversations) ? payload.conversations : null;
  } catch {
    return null;
  }
}

async function fetchConversation<Message, Extra>(id: string): Promise<StoredConversation<Message, Extra> | null> {
  try {
    const response = await fetch(`${API}/${encodeURIComponent(id)}`, { cache: "no-store" });
    if (!response.ok) return null;
    const { conversation } = await response.json() as { conversation?: StoredConversation<Message, Extra> };
    return conversation && Array.isArray(conversation.messages) ? conversation : null;
  } catch {
    return null;
  }
}

/**
 * Server entries plus local ones the server doesn't have yet (offline / pending), newest first. A local copy that was
 * synced but is missing from the server list was deleted elsewhere: it is dropped from this browser too.
 */
export function mergeHistory(userId: string, server: ConversationSummary[] | null): HistoryItem[] {
  let local: StoredConversation[] = loadHistory(userId).conversations;
  if (server) {
    const remote = new Set(server.map((entry) => entry.id));
    const synced = readSync(userId).hashes;
    for (const conversation of local) if (!remote.has(conversation.id) && synced[conversation.id]) {
      deleteConversation(userId, conversation.id);
      updateSync(userId, (state) => { delete state.hashes[conversation.id]; });
    }
    local = local.filter((conversation) => remote.has(conversation.id) || !synced[conversation.id]);
  }
  const items = new Map<string, HistoryItem>(local.map(({ id, title, updatedAt }) => [id, { id, title, updatedAt }]));
  for (const entry of server ?? []) {
    const own = items.get(entry.id);
    items.set(entry.id, own && own.updatedAt >= entry.updatedAt ? { ...own, serverUpdatedAt: entry.updatedAt } : { ...entry, serverUpdatedAt: entry.updatedAt });
  }
  return [...items.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_CONVERSATIONS);
}

/** Newest copy of a conversation: the local cache unless the server holds a newer one (then cached locally). */
export async function loadConversation<Message, Extra>(userId: string, item: HistoryItem): Promise<StoredConversation<Message, Extra> | null> {
  const local = loadHistory<Message, Extra>(userId).conversations.find((conversation) => conversation.id === item.id) ?? null;
  if (local && (item.serverUpdatedAt === undefined || local.updatedAt >= item.serverUpdatedAt)) return local;
  const remote = await fetchConversation<Message, Extra>(item.id);
  if (!remote) return local;
  saveConversation(userId, remote);
  updateSync(userId, (state) => { state.hashes[remote.id] = contentHash(remote); });
  return remote;
}

/**
 * Called once the account is known. Uploads this browser's history the first time the server is empty
 * (local → server migration), and returns the server copy of `activeId` when it is newer than the local one.
 */
export async function syncWithServer<Message, Extra>(userId: string, activeId: string | null, localUpdatedAt: number): Promise<{ conversation: StoredConversation<Message, Extra> | null; activeMissing: boolean }> {
  const server = await fetchConversationList();
  if (!server) return { conversation: null, activeMissing: false };
  const state = readSync(userId);
  const remoteIds = new Set(server.map((item) => item.id));
  let activeMissing = false;
  for (const local of loadHistory<Message, Extra>(userId).conversations) {
    if (remoteIds.has(local.id) || !state.hashes[local.id]) continue;
    deleteConversation(userId, local.id);
    delete state.hashes[local.id];
    if (local.id === activeId) activeMissing = true;
  }
  if (activeMissing) updateSync(userId, (current) => { delete current.hashes[activeId!]; });
  if (!server.length && !state.migrated) {
    const local = loadHistory<Message, Extra>(userId).conversations;
    // Oldest first; failures stay unsynced and retry on their next save (or the next load, still unmigrated).
    const results = await Promise.all([...local].reverse().map((conversation) => enqueue(() => push(userId, conversation))));
    if (results.every(Boolean)) updateSync(userId, (current) => { current.migrated = true; });
    return { conversation: null, activeMissing };
  }
  if (!state.migrated) updateSync(userId, (current) => { current.migrated = true; });
  const entry = activeId ? server.find((item) => item.id === activeId) : undefined;
  const conversation = entry && entry.updatedAt > localUpdatedAt ? await loadConversation<Message, Extra>(userId, { ...entry, serverUpdatedAt: entry.updatedAt }) : null;
  return { conversation, activeMissing };
}

/** Marks conversations inactive on the server, then removes their local cache only after confirmation. */
export async function deactivateConversations(userId: string, ids: string[]): Promise<boolean> {
  const uniqueIds = [...new Set(ids)];
  if (!uniqueIds.length) return true;
  try {
    const response = await fetch(API, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: uniqueIds }),
    });
    if (!response.ok) return false;
  } catch {
    return false;
  }
  if (pending?.userId === userId && uniqueIds.includes(pending.conversation.id)) {
    pending = null;
    window.clearTimeout(timer);
  }
  for (const id of uniqueIds) deleteConversation(userId, id);
  updateSync(userId, (state) => { for (const id of uniqueIds) delete state.hashes[id]; });
  return true;
}

const OWNER_KEY = "leadta:leadtita-history-owner";

/**
 * Called by lib/client/session.ts with every definitive session answer. Signing out (no user) or switching accounts
 * clears the Leadtita history stored in this browser, so every logout path is covered without touching each handler.
 */
export function syncHistoryOwner(userId: string | null) {
  const owner = read(OWNER_KEY);
  if (owner && owner !== (userId ?? "")) clearLeadtitaHistory();
  if (userId) {
    write(OWNER_KEY, userId);
    return;
  }
  memory.delete(OWNER_KEY);
  try {
    window.localStorage.removeItem(OWNER_KEY);
  } catch {
    // Storage unavailable.
  }
}

/** Drops every Leadtita history stored in this browser (any account). */
export function clearLeadtitaHistory() {
  window.clearTimeout(timer);
  pending = null;
  for (const key of [...memory.keys()]) if (key.startsWith(PREFIX)) memory.delete(key);
  try {
    for (let index = window.localStorage.length - 1; index >= 0; index--) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(PREFIX)) window.localStorage.removeItem(key);
    }
  } catch {
    // Storage unavailable: nothing persisted to clear.
  }
}
