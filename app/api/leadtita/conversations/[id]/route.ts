import { conversationJson as json, deactivateConversations, getConversation, isClientId, sameOrigin, sessionUserId } from "@/lib/server/leadtita-conversations";

type Context = { params: Promise<{ id: string }> };

/** Full conversation (messages + card state) of the session user. */
export async function GET(request: Request, { params }: Context) {
  const { id } = await params;
  if (!isClientId(id)) return json({ error: "not_found" }, 404);
  const userId = await sessionUserId(request);
  if (typeof userId !== "string") return userId;
  try {
    const conversation = await getConversation(userId, id);
    return conversation ? json({ conversation }) : json({ error: "not_found" }, 404);
  } catch (error) {
    console.error("Leadtita conversation read failed", error instanceof Error ? error.name : "unknown");
    return json({ error: "read_failed" }, 503);
  }
}

export async function DELETE(request: Request, { params }: Context) {
  if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);
  const { id } = await params;
  if (!isClientId(id)) return json({ error: "not_found" }, 404);
  const userId = await sessionUserId(request);
  if (typeof userId !== "string") return userId;
  try {
    await deactivateConversations(userId, [id]);
    return json({ ok: true });
  } catch (error) {
    console.error("Leadtita conversation delete failed", error instanceof Error ? error.name : "unknown");
    return json({ error: "delete_failed" }, 503);
  }
}
