import { conversationJson as json, sameOrigin, sessionUserId } from "@/lib/server/leadtita-conversations";
import { ScheduleError, updateScheduled } from "@/lib/server/scheduled-messages";

type Context = { params: Promise<{ id: string }> };
const MAX_BODY_BYTES = 16_000;

/** Cancel (`{ action: "cancel" }`) or reschedule/edit (`{ sendAt, subject?, body }`) one of the user's scheduled messages. */
export async function PATCH(request: Request, { params }: Context) {
  if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);
  const { id } = await params;
  const userId = await sessionUserId(request);
  if (typeof userId !== "string") return userId;
  let input: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return json({ error: "invalid" }, 413);
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return json({ error: "invalid" }, 400);
    input = parsed as Record<string, unknown>;
  } catch {
    return json({ error: "invalid" }, 400);
  }
  try {
    return json({ item: await updateScheduled(userId, id, input) });
  } catch (error) {
    if (error instanceof ScheduleError) return json({ error: error.code }, error.code === "not_found" ? 404 : error.code === "not_editable" ? 409 : 400);
    console.error("Scheduled update failed", error instanceof Error ? error.name : "unknown");
    return json({ error: "update_failed" }, 503);
  }
}
