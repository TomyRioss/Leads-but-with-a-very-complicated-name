import { GoogleNotConnectedError, getValidAccessToken } from "@/lib/server/google-connections";
import { isConfigured, json, requireUser } from "../_shared";

/** Access token de corta vida SOLO para abrir Google Picker en el navegador del propio usuario. Nunca se loguea. */
export async function GET(request: Request) {
  const user = await requireUser(request);
  if (!user) return json({ error: "unauthorized" }, 401);
  if (!isConfigured()) return json({ error: "not_configured" }, 503);
  try {
    return json({ accessToken: await getValidAccessToken(user.id) });
  } catch (error) {
    if (error instanceof GoogleNotConnectedError) return json({ error: "not_connected" }, 409);
    console.error("Google Drive picker token failed", error instanceof Error ? error.name : "unknown");
    return json({ error: "token_failed" }, 503);
  }
}
