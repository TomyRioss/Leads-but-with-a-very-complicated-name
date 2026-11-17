import { Client } from "@modelcontextprotocol/client";
import { fromJsonSchema, InMemoryTransport, McpServer, type JsonSchemaType } from "@modelcontextprotocol/server";

export type McpFunctionTool = {
  type: string;
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));

/** A real MCP connection scoped to one authenticated chat/confirmation request.
 * The executor closes over server-owned auth and chat state; neither crosses model arguments.
 */
export async function connectLeadtitaMcp(
  definitions: readonly McpFunctionTool[],
  execute: (name: string, args: Record<string, unknown>) => Promise<unknown>,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
) {
  options.signal?.throwIfAborted();
  const timeout = Math.max(1, Math.min(options.timeoutMs ?? 300_000, 300_000));
  const server = new McpServer({ name: "leadtita-tools", version: "1.0.0" });
  const client = new Client({ name: "leadtita-openrouter", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    options.signal?.removeEventListener("abort", abort);
    await Promise.allSettled([client.close(), server.close()]);
  };
  const abort = () => { void close(); };

  try {
    for (const definition of definitions) {
      const tool = definition.function;
      server.registerTool(tool.name, {
        description: tool.description,
        inputSchema: fromJsonSchema<Record<string, unknown>>(tool.parameters as JsonSchemaType),
      }, async (args) => {
        options.signal?.throwIfAborted();
        if (closed) throw new Error("Leadtita MCP connection is closed.");
        let result: unknown;
        try { result = await execute(tool.name, args); }
        catch (error) {
          options.signal?.throwIfAborted();
          console.error("Leadtita MCP tool failed", tool.name, error instanceof Error ? error.name : "unknown");
          result = { error: "Tool failed." };
        }
        const serialized = JSON.stringify(result ?? null);
        return {
          content: [{ type: "text" as const, text: serialized }],
          ...(isObject(result) && typeof result.error === "string" ? { isError: true } : {}),
        };
      });
    }
    options.signal?.addEventListener("abort", abort, { once: true });
    options.signal?.throwIfAborted();
    await server.connect(serverTransport);
    await client.connect(clientTransport, { signal: options.signal, timeout: 15_000 });
    const listing = await client.listTools(undefined, { signal: options.signal, timeout: 15_000 });
    const tools: McpFunctionTool[] = listing.tools.map((tool) => ({
      type: "function",
      function: { name: tool.name, description: tool.description ?? "", parameters: tool.inputSchema },
    }));
    const names = new Set(tools.map((tool) => tool.function.name));
    return {
      tools,
      async callTool(name: string, rawArguments: string): Promise<unknown> {
        options.signal?.throwIfAborted();
        if (closed) throw new Error("Leadtita MCP connection is closed.");
        if (!names.has(name)) return { error: `Unknown MCP tool ${name}.` };
        let args: unknown;
        try { args = JSON.parse(rawArguments || "{}"); }
        catch { return { error: "Invalid JSON arguments." }; }
        if (!isObject(args)) return { error: "Arguments must be a JSON object." };
        // Protocol/transport errors deliberately propagate: never retry a possibly applied write.
        const result = await client.callTool({ name, arguments: args }, { signal: options.signal, timeout });
        const text = result.content.filter((item) => item.type === "text").map((item) => item.text).join("\n");
        let value: unknown;
        try { value = JSON.parse(text); }
        catch {
          if (result.isError) return { error: text || "MCP tool failed." };
          throw new Error("Leadtita MCP returned an invalid tool result.");
        }
        if (result.isError && !(isObject(value) && typeof value.error === "string")) {
          return { error: typeof value === "string" ? value : text || "MCP tool failed." };
        }
        return value;
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
