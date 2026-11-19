import { getWhatsAppMessageStatus, isWhatsAppConfigured } from "@/lib/server/whatsapp";
import { json, requireUser } from "../../../google/_shared";

export async function GET(request: Request, context: { params: Promise<{ ref: string }> }) {
  const user = await requireUser(request);
  if (!user) return json({ error: "unauthorized" }, 401);
  const { ref } = await context.params;
  if (!/^[a-f0-9]{40}$/.test(ref)) return json({ error: "invalid_ref" }, 400);
  if (!isWhatsAppConfigured()) return json({ error: "not_configured" }, 503);
  try {
    return json(await getWhatsAppMessageStatus(user.id, ref));
  } catch {
    return json({ error: "status_unavailable" }, 503);
  }
}
