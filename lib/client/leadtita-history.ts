"use client";

// Leadtita conversations persisted in this browser only (no database): one localStorage entry per user id so accounts
// sharing a browser never mix. Every storage access is guarded; when storage is unavailable or full, a per-tab memory
// copy keeps the session working. ponytail: sync across devices would need a collection + migration.

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
