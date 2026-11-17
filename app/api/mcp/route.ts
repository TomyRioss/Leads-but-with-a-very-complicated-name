import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { MCP_INSTRUCTIONS, registerMcpTools, verifyMcpRequest } from "@/lib/server/mcp/server";

// confirm_change runs confirmed lead searches, which take up to 300 s.
export const maxDuration = 300;

const handler = withMcpAuth(
  createMcpHandler(registerMcpTools, { serverInfo: { name: "leadta", version: "1.0.0" }, instructions: MCP_INSTRUCTIONS }),
  verifyMcpRequest,
  { required: true, resourceMetadataPath: "/.well-known/oauth-protected-resource/api/mcp" },
);

export { handler as GET, handler as POST, handler as DELETE };
