import { getConnection, grantedFeatures } from "@/lib/server/google-connections";
import { isConfigured, isFullAccess, json, requireUser } from "../_shared";

export async function GET(request: Request) {
  const user = await requireUser(request);
  if (!user) return json({ error: "unauthorized" }, 401);
  if (!isConfigured()) return json({ configured: false, connected: false, email: "", files: [], fullAccess: false, features: { drive: false, gmail: false, calendar: false } });
  try {
    const connection = await getConnection(user.id);
    const granted = grantedFeatures(connection?.scopes);
    return json({
      configured: true,
      connected: Boolean(connection),
      email: connection?.googleEmail ?? "",
      files: connection?.files ?? [],
      fullAccess: isFullAccess(),
      // Drive va siempre en el consentimiento base; Gmail y Calendar según lo concedido.
      features: { drive: Boolean(connection), gmail: granted.includes("gmail"), calendar: granted.includes("calendar") },
    });
  } catch (error) {
    console.error("Google Drive status failed", error instanceof Error ? error.name : "unknown");
    return json({ error: "status_failed" }, 503);
  }
}
