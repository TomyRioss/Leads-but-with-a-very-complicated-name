// OAuth 2.1 token endpoint (public clients, PKCE): authorization_code and refresh_token grants.
import { clientIp, rateLimited } from "@/lib/server/rate-limit";
import {
  exchangeAuthorizationCode,
  isFailure,
  oauthError,
  oauthIssuer,
  oauthJson,
  oauthPreflight,
  readOAuthParams,
  refreshAccessToken,
} from "@/lib/server/mcp/oauth";

export async function POST(request: Request) {
  if (rateLimited(`oauth-token:${clientIp(request)}`, 300, 60_000)) return oauthError({ error: "slow_down", status: 429 });
  const params = await readOAuthParams(request);
  if (!params) return oauthError({ error: "invalid_request", error_description: "Send application/x-www-form-urlencoded or JSON up to 16 KB." });
  if (params.getAll("grant_type").length !== 1) return oauthError({ error: "invalid_request", error_description: "grant_type is required once." });
  try {
    const grantType = params.get("grant_type");
    const result = grantType === "authorization_code"
      ? await exchangeAuthorizationCode(params, oauthIssuer(request))
      : grantType === "refresh_token"
        ? await refreshAccessToken(params)
        : { error: "unsupported_grant_type" };
    return isFailure(result) ? oauthError(result) : oauthJson(result);
  } catch (error) {
    console.error("OAuth token request failed", error instanceof Error ? error.name : "unknown");
    return oauthError({ error: "temporarily_unavailable", status: 503 });
  }
}

export const OPTIONS = oauthPreflight;
