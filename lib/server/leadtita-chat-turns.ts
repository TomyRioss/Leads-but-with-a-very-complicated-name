import { PocketBaseRequestError, pocketBaseFetch } from "@/lib/server/pocketbase";
import type { LeadSuiteChatResult } from "@/lib/server/lead-suite-agent";

const COLLECTION = "leadtita_chat_turns";
const RECORDS = `/api/collections/${COLLECTION}/records`;
const MAX_RESULT_BYTES = 500_000;
const MAX_REPLY_CHARS = 30_000;
const MAX_ACTIONS = 20;
const USER_ID = /^[A-Za-z0-9]{15}$/;
const CLIENT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const ERROR_CODES = new Set(["chat_failed", "unavailable", "aborted", "context_full", "result_too_large", "result_invalid"]);
const ACTION_TYPES = new Set([
  "pending_change",
  "lead_candidates",
  "message_suggestions",
  "google_connect",
  "google_feature_connect",
  "whatsapp_connect",
  "drive_file",
  "batch_updated",
  "message_model_choice",
  "message_model_delete_confirmation",
]);

export type ChatTurnResultIssue = "invalid_shape" | "reply_too_long" | "too_many_actions" | "unknown_action" | "result_too_large" | "not_serializable";

export class ChatTurnResultError extends TypeError {
  constructor(
    readonly issue: ChatTurnResultIssue,
    readonly replyChars: number,
    readonly actionCount: number,
    readonly resultBytes: number | null,
    readonly actionTypes: string[],
  ) {
    super("Chat turn result failed validation.");
    this.name = "ChatTurnResultError";
  }
}

export type ChatTurnRecord = {
  userId: string;
  conversationId: string;
  turnId: string;
  status: "running" | "completed" | "failed";
  result?: LeadSuiteChatResult;
  errorCode?: string;
};

export type ChatTurnClaim =
  | { kind: "claimed" }
  | { kind: "running" }
  | { kind: "completed"; result: LeadSuiteChatResult }
  | { kind: "failed"; errorCode: string };

export type ChatTurnOutcome =
  | { status: "completed"; result: LeadSuiteChatResult }
  | { status: "failed"; errorCode: string };

type Row = {
  id: string;
  user: string;
  conversation_id: string;
  turn_id: string;
  status: string;
  result?: unknown;
  error_code?: string;
};

const quote = (value: string) => JSON.stringify(value);
const recordPath = (id: string) => `${RECORDS}/${encodeURIComponent(id)}`;
const validIdentifiers = (userId: string, conversationId: string, turnId: string) =>
  USER_ID.test(userId) && CLIENT_ID.test(conversationId) && CLIENT_ID.test(turnId);
const ownerFilter = (userId: string, conversationId: string, turnId: string) =>
  `user = ${quote(userId)} && conversation_id = ${quote(conversationId)} && turn_id = ${quote(turnId)}`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateResult(value: unknown): LeadSuiteChatResult {
  const reply = isRecord(value) && typeof value.reply === "string" ? value.reply : "";
  const actions = isRecord(value) && Array.isArray(value.actions) ? value.actions : [];
  const actionTypes = actions.slice(0, MAX_ACTIONS).map((action) => isRecord(action) && typeof action.type === "string" ? action.type.slice(0, 80) : "invalid");
  const fail = (issue: ChatTurnResultIssue, bytes: number | null = null): never => {
    throw new ChatTurnResultError(issue, reply.length, actions.length, bytes, actionTypes);
  };
  if (!isRecord(value) || typeof value.reply !== "string" || !Array.isArray(value.actions)) fail("invalid_shape");
  if (reply.length > MAX_REPLY_CHARS) fail("reply_too_long");
  if (actions.length > MAX_ACTIONS) fail("too_many_actions");
  if (!actions.every((action) => isRecord(action) && typeof action.type === "string" && ACTION_TYPES.has(action.type))) fail("unknown_action");
  let bytes: number;
  try {
    bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return fail("not_serializable");
  }
  if (bytes > MAX_RESULT_BYTES) fail("result_too_large", bytes);
  return value as unknown as LeadSuiteChatResult;
}

async function findTurn(userId: string, conversationId: string, turnId: string): Promise<Row | null> {
  const query = new URLSearchParams({
    filter: ownerFilter(userId, conversationId, turnId),
    perPage: "1",
    skipTotal: "1",
    fields: "id,user,conversation_id,turn_id,status,result,error_code",
  });
  const response = await pocketBaseFetch<{ items: Row[] }>(`${RECORDS}?${query}`);
  const row = response.items[0] ?? null;
  if (row && (row.user !== userId || row.conversation_id !== conversationId || row.turn_id !== turnId)) {
    throw new Error("PocketBase returned a chat turn outside its requested scope.");
  }
  return row;
}

function duplicateResult(row: Row): ChatTurnClaim {
  if (row.status === "running") return { kind: "running" };
  if (row.status === "completed") {
    let result: LeadSuiteChatResult;
    try { result = validateResult(row.result); } catch { throw new Error("Stored chat turn result is invalid."); }
    return { kind: "completed", result };
  }
  if (row.status === "failed" && typeof row.error_code === "string" && ERROR_CODES.has(row.error_code)) {
    return { kind: "failed", errorCode: row.error_code };
  }
  throw new Error("Stored chat turn status is invalid.");
}

/** Creates the unique claim first; only a unique-index collision is treated as an existing turn. */
export async function claimChatTurn(userId: string, conversationId: string, turnId: string): Promise<ChatTurnClaim> {
  if (!validIdentifiers(userId, conversationId, turnId)) throw new TypeError("Invalid chat turn identifiers.");
  try {
    await pocketBaseFetch<Row>(RECORDS, {
      method: "POST",
      body: JSON.stringify({ user: userId, conversation_id: conversationId, turn_id: turnId, status: "running" }),
    });
    return { kind: "claimed" };
  } catch (error) {
    if (!(error instanceof PocketBaseRequestError) || error.status !== 400) throw error;
    const existing = await findTurn(userId, conversationId, turnId);
    if (!existing) throw error;
    return duplicateResult(existing);
  }
}

/** Stores only a bounded final result or a safe error code, and never changes a terminal record. */
export async function finishChatTurn(
  userId: string,
  conversationId: string,
  turnId: string,
  outcome: ChatTurnOutcome,
): Promise<void> {
  if (!validIdentifiers(userId, conversationId, turnId)) throw new TypeError("Invalid chat turn identifiers.");
  let patch: Record<string, unknown>;
  if (outcome.status === "completed") {
    const result = validateResult(outcome.result);
    patch = { status: "completed", result, error_code: "" };
  } else if (outcome.status === "failed" && ERROR_CODES.has(outcome.errorCode)) {
    patch = { status: "failed", result: null, error_code: outcome.errorCode };
  } else {
    throw new TypeError("Invalid chat turn outcome.");
  }

  const row = await findTurn(userId, conversationId, turnId);
  if (!row) throw new Error("Chat turn claim was not found for this account.");
  if (row.status !== "running") return;

  // PocketBase patches records by id; the exact row was just selected by the full owner key.
  // Repeat the immutable key fields in the patch so a malformed record cannot be reassigned.
  await pocketBaseFetch(recordPath(row.id), {
    method: "PATCH",
    body: JSON.stringify({
      user: userId,
      conversation_id: conversationId,
      turn_id: turnId,
      ...patch,
    }),
  });
}
