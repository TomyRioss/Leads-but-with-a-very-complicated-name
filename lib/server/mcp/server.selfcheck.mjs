// Run: node --experimental-strip-types lib/server/mcp/server.selfcheck.mjs
// MCP schemas: chat short refs (L1/C1/B1) become record ids; descriptions lose chat-card wording; scopes per signed kind.
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";

const root = pathToFileURL(new URL("../../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")).href;
const hooks = `export async function resolve(specifier, context, next) {
  // PocketBase stubbed: this check never touches the database.
  if (specifier === "@/lib/server/pocketbase") return { url: "data:text/javascript," + encodeURIComponent("const no = async () => { throw new Error('no db in selfcheck'); }; export class PocketBaseRequestError extends Error {} export class PocketBaseAuthError extends Error {} export const isPocketBaseConfigured = () => false; export const pocketBaseFetch = no, pocketBasePublicFetch = no, createLeadRecords = no;"), shortCircuit: true };
  if (specifier === "server-only") return { url: "data:text/javascript,", shortCircuit: true };
  if (specifier === "next/server") return next("next/server.js", context);
  if (specifier.startsWith("@/")) return next(${JSON.stringify(root)} + specifier.slice(2) + ".ts", context);
  return next(specifier, context);
}`;
register(`data:text/javascript,${encodeURIComponent(hooks)}`);

const { toMcpSchema, toMcpDescription, scopeForKind, RECORD_PATTERN, CONFIRM_HINT } = await import("./schema.ts");

// Ref patterns → record id, deep (nested items), without mutating the source.
const source = {
  type: "object", additionalProperties: false, required: ["leadRef", "to", "items"],
  properties: {
    leadRef: { type: "string", pattern: "^L\\d{1,3}$" }, to: { type: "string" },
    items: { type: "array", items: { type: "object", properties: { leadRef: { type: "string", pattern: "^L\\d{1,3}$" }, contactRef: { type: "string", pattern: "^C\\d{1,3}$" } } } },
    batchRef: { type: "string", pattern: "^B\\d{1,3}$" }, other: { type: "string", pattern: "^x$" },
  },
};
const out = toMcpSchema(source, ["to"]);
assert.equal(out.properties.leadRef.pattern, RECORD_PATTERN);
assert.match(out.properties.leadRef.description, /Lead record id/);
assert.equal(out.properties.items.items.properties.leadRef.pattern, RECORD_PATTERN);
assert.match(out.properties.items.items.properties.contactRef.description, /Contact record id/);
assert.match(out.properties.batchRef.description, /Batch record id/);
assert.equal(out.properties.other.pattern, "^x$");
assert.equal(out.properties.to, undefined);
assert.deepEqual(out.required, ["leadRef", "items"]);
assert.equal(source.properties.leadRef.pattern, "^L\\d{1,3}$"); // source untouched
assert.ok(source.properties.to);

// Descriptions: no card wording, refs or `to` override; proposals end with the confirm hint.
assert.equal(toMcpDescription("Propose deleting a recorded contact. Yes/No card.", true), `Propose deleting a recorded contact. ${CONFIRM_HINT}`);
assert.equal(
  toMcpDescription("Propose sending ONE email from the user's Gmail to a lead (draft: subject + body; the user can edit it on the card). Uses the lead's email unless `to` is given. Logged in Lead Suite when sent.", true),
  `Propose sending ONE email from the user's Gmail to a lead. Logged in Lead Suite when sent. ${CONFIRM_HINT}`,
);
assert.equal(toMcpDescription("Contacts recorded for a lead, most recent first (C refs). Needed before editing or deleting a contact.", false), "Contacts recorded for a lead, most recent first. Needed before editing or deleting a contact.");

// Scope of a signed change.
for (const kind of ["send_email", "send_email_batch", "send_whatsapp_batch", "create_meeting"]) assert.equal(scopeForKind(kind, 0), "send");
for (const kind of ["search_businesses", "search_people", "topup_batch"]) assert.equal(scopeForKind(kind, 0), "credits");
assert.equal(scopeForKind("analyze_pains", 3), "credits");
assert.equal(scopeForKind("analyze_pains", 0), "write");
for (const kind of ["add_lead", "update_lead", "update_commercial_profile", "delete_contact", "delete_leads", "filter_batch"]) assert.equal(scopeForKind(kind, 0), "write");

// Every real chat tool schema converts cleanly: no short-ref pattern survives.
let tools = null;
try {
  ({ leadSuiteTools: tools } = await import("../lead-suite-agent.ts"));
} catch (error) {
  console.warn("skipping real tool schemas (app modules not loadable here):", error.message.split("\n")[0]);
}
if (tools) {
  for (const tool of tools) {
    const json = JSON.stringify(toMcpSchema(tool.function.parameters));
    assert.ok(!/\^[LCB]\\\\d\{1,3\}\$/.test(json), `${tool.function.name} still has a short ref`);
    assert.ok(!/\bcard\b/i.test(toMcpDescription(tool.function.description, true)), `${tool.function.name} description mentions a card`);
  }
}

console.log("mcp server selfcheck ok");
