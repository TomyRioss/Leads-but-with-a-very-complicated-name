import { isWhatsAppConfigured, startWhatsAppSession } from "@/lib/server/whatsapp";
import { json, requireUser, sameOrigin } from "../../google/_shared";
import { notConfiguredState, toClientState } from "../_shared";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);
  const user = await requireUser(request);
  if (!user) return json({ error: "unauthorized" }, 401);
  if (!isWhatsAppConfigured()) return json(notConfiguredState);
  try {
    const session = await startWhatsAppSession(user.id);
    // Baileys may fail while opening its socket and report `disconnected` without an HTTP error.
    // Surface that failure so the client can explain it and leave the retry button available.
    if (session.status === "disconnected") return json({ error: "connect_failed" }, 502);
    return json(await toClientState(session));
  } catch (error) {
    console.error("WhatsApp connect failed", error instanceof Error ? error.message : "unknown");
    return json({ error: "connect_failed" }, 503);
  }
}
