import { getWhatsAppSession, isWhatsAppConfigured } from "@/lib/server/whatsapp";
import { json, requireUser } from "../../google/_shared";
import { notConfiguredState, toClientState } from "../_shared";

export async function GET(request: Request) {
  const user = await requireUser(request);
  if (!user) return json({ error: "unauthorized" }, 401);
  if (!isWhatsAppConfigured()) return json(notConfiguredState);
  try {
    return json(await toClientState(await getWhatsAppSession(user.id)));
  } catch (error) {
    console.error("WhatsApp status failed", error instanceof Error ? error.message : "unknown");
    return json({ error: "status_failed" }, 503);
  }
}
