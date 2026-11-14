import { deleteConnection } from "@/lib/server/google-connections";
import { json, requireUser, sameOrigin } from "../_shared";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);
  const user = await requireUser(request);
  if (!user) return json({ error: "unauthorized" }, 401);
  try {
    await deleteConnection(user.id);
    return json({ ok: true });
  } catch (error) {
    console.error("Google Drive disconnect failed", error instanceof Error ? error.name : "unknown");
    return json({ error: "disconnect_failed" }, 503);
  }
}
