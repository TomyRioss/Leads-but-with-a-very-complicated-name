import { isWhatsAppConfigured, stopWhatsAppSession } from "@/lib/server/whatsapp";
import { json, requireUser, sameOrigin } from "../../google/_shared";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);
  const user = await requireUser(request);
  if (!user) return json({ error: "unauthorized" }, 401);
  if (!isWhatsAppConfigured()) return json({ status: "disconnected" });
  try {
    return json(await stopWhatsAppSession(user.id));
  } catch (error) {
    console.error("WhatsApp disconnect failed", error instanceof Error ? error.message : "unknown");
    return json({ error: "disconnect_failed" }, 503);
  }
}
