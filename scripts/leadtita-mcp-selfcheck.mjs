// node --experimental-strip-types scripts/leadtita-mcp-selfcheck.mjs
import assert from "node:assert/strict";
import { register } from "node:module";
import { connectLeadtitaMcp } from "../lib/server/mcp/leadtita-client.ts";

const definitions = [{ type: "function", function: {
  name: "record_contact", description: "Record a known lead contact.",
  parameters: { type: "object", properties: { leadRef: { type: "string", pattern: "^L\\d{1,3}$" } }, required: ["leadRef"], additionalProperties: false },
} }];
let calls = 0;
const actions = [];
const mcp = await connectLeadtitaMcp(definitions, async (name, args) => {
  calls++;
  actions.push({ type: "pending_change", token: "signed-preview" });
  return { name, ref: args.leadRef, proposed: true };
});
try {
  assert.equal(mcp.tools[0].function.name, "record_contact");
  assert.equal(mcp.tools[0].function.parameters.properties.leadRef.pattern, "^L\\d{1,3}$");
  assert.deepEqual(await mcp.callTool("record_contact", '{"leadRef":"L1"}'), { name: "record_contact", ref: "L1", proposed: true });
  assert.equal(actions[0].token, "signed-preview", "Action cards remain in the request closure");
  assert.ok((await mcp.callTool("record_contact", '{"leadRef":"foreign-id"}')).error, "MCP rejects schema-invalid refs");
  assert.ok((await mcp.callTool("record_contact", '{}')).error, "Required input validation runs before execution");
  assert.ok((await mcp.callTool("record_contact", '[]')).error);
  assert.ok((await mcp.callTool("record_contact", '{')).error);
  assert.ok((await mcp.callTool("missing", '{}')).error);
  assert.equal(calls, 1, "Invalid calls never execute application actions");
} finally { await mcp.close(); }
await assert.rejects(mcp.callTool("record_contact", '{"leadRef":"L1"}'), /closed/);

const failure = await connectLeadtitaMcp(definitions, async () => ({ error: "Permission denied." }));
assert.deepEqual(await failure.callTool("record_contact", '{"leadRef":"L1"}'), { error: "Permission denied." });
await failure.close();

const first = await connectLeadtitaMcp(definitions, async () => ({ account: "first" }));
const second = await connectLeadtitaMcp(definitions, async () => ({ account: "second" }));
assert.deepEqual(await first.callTool("record_contact", '{"leadRef":"L1"}'), { account: "first" });
assert.deepEqual(await second.callTool("record_contact", '{"leadRef":"L1"}'), { account: "second" });
await first.close();
assert.deepEqual(await second.callTool("record_contact", '{"leadRef":"L1"}'), { account: "second" }, "Closing one session cannot close another");
await second.close();

const broken = await connectLeadtitaMcp(definitions, async () => { throw new Error("secret database details"); });
assert.deepEqual(await broken.callTool("record_contact", '{"leadRef":"L1"}'), { error: "Tool failed." }, "Internal messages never reach the model");
await broken.close();

const controller = new AbortController();
const aborted = await connectLeadtitaMcp(definitions, async () => { throw new Error("Must not execute"); }, { signal: controller.signal });
controller.abort();
await assert.rejects(aborted.callTool("record_contact", '{"leadRef":"L1"}'), { name: "AbortError" });
await aborted.close();
await assert.rejects(connectLeadtitaMcp(definitions, async () => null, { signal: controller.signal }), { name: "AbortError" });

const slow = await connectLeadtitaMcp(definitions, async () => new Promise(() => {}), { timeoutMs: 20 });
try { await assert.rejects(slow.callTool("record_contact", '{"leadRef":"L1"}'), /timeout|timed out/i); }
finally { await slow.close(); }

// Load the actual application catalog without connecting to PocketBase.
const root = new URL("../", import.meta.url).href;
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(specifier, context, next) {
  if (specifier === "@/lib/server/pocketbase") return { url: "data:text/javascript," + encodeURIComponent("const no = async () => { throw new Error('no db in selfcheck'); }; export class PocketBaseRequestError extends Error {} export class PocketBaseAuthError extends Error {} export const isPocketBaseConfigured = () => false; export const pocketBaseFetch = no, pocketBasePublicFetch = no, createLeadRecords = no;"), shortCircuit: true };
  if (specifier === "server-only") return { url: "data:text/javascript,", shortCircuit: true };
  if (specifier === "next/server") return next("next/server.js", context);
  if (specifier.startsWith("@/")) return next(${JSON.stringify(root)} + specifier.slice(2) + ".ts", context);
  return next(specifier, context);
}`)}`);
const { leadSuiteTools, canonicalToolArgs, createToolCallCache } = await import("../lib/server/lead-suite-agent.ts");
assert.equal(canonicalToolArgs('{"query":"Jalisco","limit":5}'), canonicalToolArgs('{ "limit": 5, "query": "Jalisco" }'), "Equivalent duplicate tool args share one cache key");
const toolCallCache = createToolCallCache();
toolCallCache.set("search_leads", '{"query":"Jalisco"}', { leads: [] });
assert.deepEqual(toolCallCache.get("search_leads", '{"query":"Jalisco"}'), { leads: [] }, "Repeated tool calls reuse their first result");
assert.equal(toolCallCache.has("search_leads", '{"query":"Jalisco"}'), true);
assert.equal(toolCallCache.has("search_leads", '{"query":"Colima"}'), false);
const actual = await connectLeadtitaMcp(leadSuiteTools, async () => { throw new Error("Catalog checks cannot execute actions"); });
try {
  assert.equal(actual.tools.length, leadSuiteTools.length);
  for (const source of leadSuiteTools) {
    const discovered = actual.tools.find((tool) => tool.function.name === source.function.name);
    assert.ok(discovered, `MCP discovery includes ${source.function.name}`);
    assert.equal(discovered.function.description, source.function.description);
    assert.deepEqual(discovered.function.parameters, source.function.parameters, `${source.function.name}: schema preserved`);
  }
} finally { await actual.close(); }
console.log(`leadtita MCP real catalog OK: ${leadSuiteTools.length} application tools discovered with original schemas`);
console.log("leadtita MCP selfcheck OK: discovery, calls, cards, validation, failures, closure isolation, cancellation, timeout, cleanup");
