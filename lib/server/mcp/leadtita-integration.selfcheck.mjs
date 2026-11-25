// Run: node --experimental-strip-types lib/server/mcp/leadtita-integration.selfcheck.mjs
// Real chat orchestration and MCP SDK transports; OpenRouter and domain I/O are isolated.
import assert from "node:assert/strict";
import { register } from "node:module";

const root = new URL("../../../", import.meta.url).href;
const stubs = {
  "@/lib/server/leadtita-tools": `
    export const leadtitaTools = [], LEADTITA_PROMPT = "";
    export const commercialProfilePrompt = () => "";
    export const revalidateLeadtitaExtra = () => true;
    export const applyLeadtitaChange = async () => undefined;
    export const runLeadtitaTool = async () => undefined;
    export const withKeywordSubset = (payload, value) => value === undefined ? payload : null;
    export const withGoogleEdits = (payload, value) => value === undefined ? payload : null;
    export const withBatchReview = (payload, value) => value === undefined ? payload : null;
  `,
  "@/lib/server/lead-suite": `
    const state = () => globalThis.__leadtitaCheck;
    export const listLeadDirectory = async user => user === "owner" ? state().leads : [];
    export const listLeadContacts = async (user, opts) => {
      state().reads.push({ user, leadId: opts.leadId });
      if (state().failRead) throw new Error("isolated domain failure");
      return { items: user === "owner" ? [state().contact] : [] };
    };
    export const getUserLead = async (user, id) => user === "owner" ? state().leads.find(l => l.id === id) : null;
    export const getLeadContact = async (user, id) => user === "owner" && id === state().contact.id ? state().contact : null;
    export const getUserBatch = async () => null;
    export const findDuplicateContact = async () => null;
    export const recordLeadContact = async (user, input) => {
      state().writes.push({ user, input }); return { ...state().contact, ...input };
    };
    export const updateLeadContactStatus = async (user, id, status) => {
      state().writes.push({ user, id, status });
      if (user !== "owner") throw new Error("ownership failure");
      return { ...state().leads.find(l => l.id === id), contactStatus: status };
    };
    export const deleteLeadContact = async () => { throw new Error("unexpected delete"); };
    export const updateLeadContact = async () => { throw new Error("unexpected update"); };
  `,
  "@/lib/server/user-profile": `export const getCommercialProfile = async () => ({ serviceOffering: "", commercialSectors: "" });`,
  "@/lib/server/ai-usage": `export const recordAiUsage = async () => {};`,
  "@/lib/server/leadtita-memory": `export const getAccountMemory = async () => []; export const rememberAccountFacts = async () => [];`,
  "@/lib/server/credits": `export const CREDITS_PER_PAIN_ANALYSIS = 1; export class CreditOperationBusyError extends Error {} export class InsufficientCreditsError extends Error {}`,
  "@/lib/server/leads": `export const MAX_DELETE_LEADS = 200, RECORD_ID = /^[a-z0-9]{15}$/; export const deleteBatchLeads = async () => { throw new Error("unexpected deletion"); };`,
  "@/lib/server/google-gmail": `export class GmailNotConnectedError extends Error {} export class GmailQuotaError extends Error {} export class GmailValidationError extends Error {}`,
  "@/lib/server/google-calendar": `export class CalendarNotConnectedError extends Error {} export class CalendarValidationError extends Error {}`,
  "@/lib/server/whatsapp": `export const isWhatsAppConnected = async () => false; export class WhatsAppNotConnectedError extends Error {} export class WhatsAppUnavailableError extends Error {}`,
  "@/lib/server/scheduled-messages": `export const SCHEDULABLE_KINDS = new Set(); export class ScheduleError extends Error {} export const parseSendAt = () => null; export const scheduleFromCard = async () => { throw new Error("unexpected schedule"); }; export const whatsAppMonthlyUsage = async () => ({ remaining: 0 });`,
  "@/lib/server/google-connections": `export const hasGmail = async () => false;`,
  "@/lib/server/locale": `export const getTranslator = () => () => "error";`,
  "@/lib/server/public-error": `export const uiError = (_detail, fallback) => fallback;`,
};
const hooks = `const stubs = ${JSON.stringify(stubs)};
export async function resolve(specifier, context, next) {
  if (Object.hasOwn(stubs, specifier)) return { url: "data:text/javascript," + encodeURIComponent(stubs[specifier]), shortCircuit: true };
  if (specifier === "server-only") return { url: "data:text/javascript,", shortCircuit: true };
  if (specifier.startsWith("@/")) return next(${JSON.stringify(root)} + specifier.slice(2) + ".ts", context);
  return next(specifier, context);
}`;
register(`data:text/javascript,${encodeURIComponent(hooks)}`);
process.env.EMAIL_VERIFICATION_SECRET = "isolated-integration-check";
const state = globalThis.__leadtitaCheck = {
  leads: [{ id: "lead00000000001", batchId: "batch0000000001", name: "Acme", category: "Store", city: "Miami", contactStatus: "contacted", lastContactedAt: null }],
  contact: { id: "contact00000001", leadId: "lead00000000001", leadName: "Acme", channel: "email", status: "contacted", message: "Hello", notes: "", contactedAt: "2026-11-01T12:00:00Z", created: "2026-11-01T12:00:00Z" },
  reads: [], writes: [], failRead: false,
};
const { runLeadSuiteChat, leadSuiteTools, verifyPendingChange, signPendingChange } = await import("../lead-suite-agent.ts");
const { confirmLeadtitaViaMcp } = await import("./leadtita-confirm.ts");
const modelCall = (name, args, id = name) => ({ id, type: "function", function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) } });
let replies = [], requests = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  assert.equal(String(url), "https://openrouter.ai/api/v1/chat/completions", "no external calls allowed");
  requests.push(JSON.parse(options.body));
  const message = replies.shift();
  assert.ok(message, "unexpected additional model round");
  return Response.json({ choices: [{ message }] });
};
const run = async (rounds, options = {}) => {
  replies = [...rounds, { content: "Revisá la tarjeta." }]; requests = [];
  const progress = [];
  const result = await runLeadSuiteChat({ userId: "owner", apiKey: "stub", timeZone: "America/Argentina/Buenos_Aires", messages: [{ role: "user", content: "Acme" }], onToolProgress: event => progress.push(event), ...options });
  assert.equal(replies.length, 0);
  assert.deepEqual(requests[0].tools.map(t => t.function.name).sort(), leadSuiteTools.map(t => t.function.name).sort());
  assert.ok(!requests[0].tools.some(t => t.function.name === "confirm_change"), "model cannot confirm cards");
  return { ...result, progress, toolResults: requests.at(-1).messages.filter(m => m.role === "tool").map(m => JSON.parse(m.content)) };
};
try {
  // Actual focus skills, sales channel and permission instructions survive every MCP/model round.
  for (const mode of ["seller", "generator", "planner"]) {
    for (const salesChannel of [null, "whatsapp", "gmail"]) {
      for (const permission of ["ask", "skip", "danger"]) {
        const result = await run([{ tool_calls: [modelCall("propose_update_status", { leadRef: "L1", status: "replied" })] }], { mode, salesChannel, permission });
        assert.equal(result.actions[0]?.change.kind, "update_status", `${mode}/${salesChannel}/${permission} retains MCP proposals`);
        assert.equal(verifyPendingChange(result.actions[0].token, "owner").data.status, "replied");
        for (const request of requests) {
          const prompt = request.messages.filter(message => message.role === "system").map(message => message.content).join("\n");
          assert.ok(prompt.includes(`[Trusted skill: ${mode} v2]`));
          for (const other of ["seller", "generator", "planner"].filter(value => value !== mode)) assert.ok(!prompt.includes(`[Trusted skill: ${other} `));
          assert.ok(prompt.includes(salesChannel ? `SALES CHANNEL: Prefer ${salesChannel === "whatsapp" ? "WhatsApp" : "Gmail"}` : "SALES CHANNEL: No channel preference is selected."));
          assert.equal(prompt.includes("PERMISSION skip:"), permission === "skip");
          assert.equal(prompt.includes("PERMISSION danger:"), permission === "danger");
          assert.ok(prompt.includes("MCP: all available tools"));
          assert.ok(!request.tools.some(tool => tool.function.name === "confirm_change"));
        }
      }
    }
  }
  assert.equal(state.writes.length, 0, "focus/channel/permission combinations cannot self-confirm proposals");

  // C refs discovered over MCP remain usable by later MCP calls in the same turn.
  const proposal = await run([
    { tool_calls: [modelCall("lead_history", { leadRef: "L1" })] },
    { tool_calls: [modelCall("propose_update_contact", { contactRef: "C1", notes: "Follow up" })] },
  ]);
  assert.equal(proposal.actions.length, 1);
  assert.equal(proposal.actions[0].type, "pending_change");
  assert.equal(proposal.actions[0].change.kind, "update_contact");
  assert.equal(proposal.actions[0].change.before.notes, "");
  assert.equal(verifyPendingChange(proposal.actions[0].token, "owner").contactId, state.contact.id);
  assert.equal(verifyPendingChange(proposal.actions[0].token, "other"), null);
  assert.equal(state.writes.length, 0, "proposal must not save anything");

  // MCP validates schemas before touching the domain (direct runTool accepted unknown properties).
  const readsBefore = state.reads.length;
  const invalid = await run([{ tool_calls: [
    modelCall("lead_history", { leadRef: "L1", unexpected: true }, "extra"),
    modelCall("lead_history", { leadRef: "invented" }, "bad-ref"),
    modelCall("propose_update_status", { leadRef: "L1", status: "invented" }, "bad-enum"),
    modelCall("lead_history", "{bad-json", "bad-json"),
    modelCall("confirm_change", { token: proposal.actions[0].token }, "forbidden"),
  ] }]);
  assert.equal(invalid.actions.length, 0);
  assert.equal(state.reads.length, readsBefore);
  assert.equal(invalid.progress.filter(e => e.type === "tool_failed").length, 5);
  assert.ok(invalid.toolResults.every(result => typeof result.error === "string"));
  assert.equal(state.writes.length, 0);

  state.failRead = true;
  const failed = await run([{ tool_calls: [modelCall("lead_history", { leadRef: "L1" })] }]);
  state.failRead = false;
  assert.equal(failed.actions.length, 0);
  assert.ok(failed.progress.some(e => e.type === "tool_failed"));
  assert.equal(typeof failed.toolResults[0].error, "string");

  // The confirmation bridge preserves real domain validation and binds the authenticated user.
  const statusToken = signPendingChange({ uid: "owner", kind: "update_status", leadId: state.leads[0].id, leadName: "Acme", data: { status: "won" } });
  const confirm = (user, token, extra = {}) => confirmLeadtitaViaMcp({ id: user, credits: 100 }, { token, ...extra }, { locale: "es" });
  assert.deepEqual(await confirm("other", statusToken), { ok: false, status: 400 });
  for (const token of [undefined, null, 3, "malformed", `${statusToken}tampered`]) {
    assert.deepEqual(await confirm("owner", token), { ok: false, status: 400 });
  }
  assert.equal(state.writes.length, 0);
  const applied = await confirm("owner", statusToken);
  assert.equal(applied.ok, true);
  assert.equal(applied.result.kind, "update_status");
  assert.equal(applied.result.lead.contactStatus, "won");
  assert.deepEqual(state.writes, [{ user: "owner", id: state.leads[0].id, status: "won" }]);
  const expensiveToken = signPendingChange({ uid: "owner", kind: "search_businesses", leadId: "", leadName: "Search", data: {}, extra: { credits: 31 } });
  assert.deepEqual(await confirm("owner", expensiveToken, { auto: "skip" }), { ok: false, status: 409, code: "needs_confirmation" });
  assert.deepEqual(await confirm("owner", statusToken, { sendAt: "invalid" }), { ok: false, status: 400, code: "invalid_send_at" });
  assert.equal(state.writes.length, 1, "rejected confirmations cannot execute domain writes");

  console.log("Leadtita MCP integration selfcheck ok: 27 focus/channel/permission combinations, discovery, refs, proposals, schema rejection, domain errors, authenticated confirmation");
} finally {
  globalThis.fetch = originalFetch;
  delete globalThis.__leadtitaCheck;
}
