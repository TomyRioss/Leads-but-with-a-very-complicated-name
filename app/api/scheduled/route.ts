import { conversationJson as json, sameOrigin, sessionUserId } from "@/lib/server/leadtita-conversations";
import { createScheduled, freeSchedulesLeft, listScheduled, ScheduleError } from "@/lib/server/scheduled-messages";

const MAX_BODY_BYTES = 16_000;

/** "Programados" of the session user (pending, failed, last 14 days) and how many free schedules are left this month (null = unlimited). */
export async function GET(request: Request) {
  const userId = await sessionUserId(request);
  if (typeof userId !== "string") return userId;
  try {
    const [items, left] = await Promise.all([listScheduled(userId), freeSchedulesLeft(userId)]);
    return json({ items, freeLeft: Number.isFinite(left) ? left : null });
  } catch (error) {
    console.error("Scheduled list failed", error instanceof Error ? error.name : "unknown");
    return json({ error: "list_failed" }, 503);
  }
}

/** Manual "Nuevo programado": `{ channel, leadId, sendAt, subject?, body }`; the recipient comes from the lead. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);
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
    return json({ item: await createScheduled(userId, input) }, 201);
  } catch (error) {
    if (error instanceof ScheduleError) return json({ error: error.code }, error.code === "not_found" ? 404 : error.code.startsWith("needs_") ? 409 : 400);
    console.error("Scheduled create failed", error instanceof Error ? error.name : "unknown");
    return json({ error: "create_failed" }, 503);
  }
}
