// RFC 7009 token revocation: 200 for any token (known or not); 503 only when the revocation couldn't be stored.
import { clientIp, rateLimited } from "@/lib/server/rate-limit";
import { oauthError, oauthPreflight, readOAuthParams, revokeToken } from "@/lib/server/mcp/oauth";

const ok = () => new Response(null, { status: 200, headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  if (rateLimited(`oauth-revoke:${clientIp(request)}`, 120, 60_000)) return oauthError({ error: "slow_down", status: 429 });
  const params = await readOAuthParams(request);
  const token = params?.get("token");
  if (!params || !token) return oauthError({ error: "invalid_request", error_description: "token is required." });
  try {
    await revokeToken(token, params.get("client_id") ?? "");
  } catch (error) {
    console.error("OAuth revocation failed", error instanceof Error ? error.name : "unknown");
    return oauthError({ error: "temporarily_unavailable", status: 503 });
  }
  return ok();
}

export const OPTIONS = oauthPreflight;
