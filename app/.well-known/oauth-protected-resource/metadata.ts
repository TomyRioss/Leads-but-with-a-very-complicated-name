// RFC 9728 protected resource metadata for /api/mcp, shared by the root and path-suffixed well-known routes.
import { generateProtectedResourceMetadata } from "mcp-handler";
import { MCP_SCOPES, mcpResourceUrl, oauthIssuer } from "@/lib/server/mcp/oauth";

export function protectedResourceMetadata(request: Request) {
  const issuer = oauthIssuer(request);
  const metadata = generateProtectedResourceMetadata({
    authServerUrls: [issuer],
    resourceUrl: mcpResourceUrl(issuer),
    additionalMetadata: { scopes_supported: [...MCP_SCOPES], bearer_methods_supported: ["header"], resource_name: "leadta" },
  });
  return Response.json(metadata, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Max-Age": "86400",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
