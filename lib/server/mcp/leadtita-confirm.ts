import { confirmPendingChange, type ConfirmInput, type ConfirmOutcome } from "@/lib/server/lead-suite-confirm";
import { connectLeadtitaMcp, type McpFunctionTool } from "@/lib/server/mcp/leadtita-client";

// This capability is created only after the confirmation endpoint authenticates the user and checks the
// conversation. It is never advertised to OpenRouter: a model cannot approve its own proposals.
const confirmationTool: McpFunctionTool = {
  type: "function",
  function: {
    name: "confirm_change",
    description: "Execute a signed action approved through the authenticated Leadtita confirmation card.",
    parameters: {
      type: "object", additionalProperties: false, required: ["token"],
      // The domain validator remains authoritative for signed payloads, edits, subsets and permission modes.
      properties: { token: {}, keywords: {}, edits: {}, review: {}, sendAt: {}, auto: {} },
    },
  },
};

export async function confirmLeadtitaViaMcp(
  user: { id: string; credits: number }, input: ConfirmInput, opts: { locale: "es" | "en" },
): Promise<ConfirmOutcome> {
  const mcp = await connectLeadtitaMcp([confirmationTool], (_name, args) =>
    confirmPendingChange(user, { token: args.token, keywords: args.keywords, edits: args.edits, review: args.review, sendAt: args.sendAt, auto: args.auto }, opts));
  try {
    // Preserve malformed/missing-token handling in the existing domain validator (HTTP 400).
    const result = await mcp.callTool("confirm_change", JSON.stringify({ ...input, token: input.token ?? null }));
    if (result && typeof result === "object" && "ok" in result) {
      if (result.ok === true && "result" in result) return { ok: true, result: result.result };
      if (result.ok === false && "status" in result && typeof result.status === "number") return result as ConfirmOutcome;
    }
    return { ok: false, status: 503 };
  } finally {
    await mcp.close();
  }
}
