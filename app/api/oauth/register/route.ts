// RFC 7591 dynamic client registration (stateless: the client_id is a signed blob).
import { clientIp, rateLimited } from "@/lib/server/rate-limit";
import { isFailure, oauthError, oauthJson, oauthPreflight, readJsonObject, registerClient } from "@/lib/server/mcp/oauth";

export async function POST(request: Request) {
  if (rateLimited(`oauth-register:${clientIp(request)}`, 60, 60_000)) return oauthError({ error: "slow_down", status: 429 });
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return oauthError({ error: "invalid_client_metadata", error_description: "Content-Type must be application/json." });
  }
  const body = await readJsonObject(request);
  if (!body) return oauthError({ error: "invalid_client_metadata", error_description: "Body must be a JSON object up to 16 KB." });
  const result = registerClient(body);
  return isFailure(result) ? oauthError(result) : oauthJson(result.body, result.status);
}

export const OPTIONS = oauthPreflight;
