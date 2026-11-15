import { ConversationTooLargeError, cleanConversation, conversationJson as json, deactivateConversations, listConversations, sameOrigin, sessionUserId, upsertConversation } from "@/lib/server/leadtita-conversations";

// Room for 2 MB of messages + 500 KB of card state + JSON envelope.
const MAX_BODY_BYTES = 2_600_000;

/** Conversations of the session user, newest first, without messages. */
export async function GET(request: Request) {
  const userId = await sessionUserId(request);
  if (typeof userId !== "string") return userId;
  try {
    return json({ conversations: await listConversations(userId) });
  } catch (error) {
    console.error("Leadtita conversations list failed", error instanceof Error ? error.name : "unknown");
    return json({ error: "list_failed" }, 503);
  }
}

/** Upsert one conversation of the session user: { conversation: { id, title, updatedAt, messages, extra } }. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);
  const userId = await sessionUserId(request);
  if (typeof userId !== "string") return userId;

  let conversation;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return json({ error: "too_large" }, 413);
    conversation = cleanConversation((JSON.parse(raw) as { conversation?: unknown } | null)?.conversation);
  } catch (error) {
    if (error instanceof ConversationTooLargeError) return json({ error: "too_large" }, 413);
    return json({ error: "invalid_body" }, 400);
  }
  if (!conversation) return json({ error: "invalid_body" }, 400);

  try {
    const saved = await upsertConversation(userId, conversation);
    if (!saved) return json({ error: "conversation_inactive" }, 410);
    return json({ ok: true, updatedAt: conversation.updatedAt, messageCount: conversation.messages.length });
  } catch (error) {
    console.error("Leadtita conversation save failed", error instanceof Error ? error.name : "unknown");
    return json({ error: "save_failed" }, 503);
  }
}

/** Mark one or more conversations inactive while preserving their database records. */
export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);
  const userId = await sessionUserId(request);
  if (typeof userId !== "string") return userId;
  let ids: string[];
  try {
    const body = await request.json() as { ids?: unknown };
    if (!Array.isArray(body?.ids) || !body.ids.length || body.ids.length > 30 || body.ids.some((id) => typeof id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(id))) {
      return json({ error: "invalid_ids" }, 400);
    }
    ids = body.ids;
  } catch {
    return json({ error: "invalid_ids" }, 400);
  }
  try {
    await deactivateConversations(userId, ids);
    return json({ ok: true });
  } catch (error) {
    console.error("Leadtita conversation deactivation failed", error instanceof Error ? error.name : "unknown");
    return json({ error: "deactivation_failed" }, 503);
  }
}
