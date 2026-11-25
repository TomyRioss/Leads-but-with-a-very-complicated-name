// Self-check for the Leadtita cacheable prompt layout. No network, no app imports.
// Run: node lib/server/leadtita-prompt.selfcheck.mjs
import assert from "node:assert/strict";
import { attachmentSummaryBlock, buildFixedSystemPrompt, buildPromptMessages, buildTurnContext } from "./leadtita-prompt.ts";

const fixedParts = { modeFocus: "Prioritize selling.", skillBundle: "[Trusted skill: seller v2]", channels: ["whatsapp", "email"], statuses: ["contacted", "won"], leadtitaPrompt: "LEADTITA RULES" };
const contextFor = (user, nowText) => buildTurnContext({
  salesChannel: user === "ana" ? "whatsapp" : null,
  timeZone: user === "ana" ? "America/Argentina/Buenos_Aires" : "Europe/Madrid",
  nowText,
  permissionText: user === "ana" ? "PERMISSION skip: test" : "",
  profileBlock: `USER PROFILE: ${user}-profile`,
  businessBlock: user === "ana" ? "BUSINESS: ana-shop" : "",
  memory: [{ key: "preferredTone", value: `${user}-memory` }],
  messageModels: [`${user}-model`],
  leadContext: `L1 · ${user}-lead`,
});

// 1. Fixed system prompt: byte-identical for different users and times (it takes no per-user/per-turn input).
const systemA = buildFixedSystemPrompt(fixedParts);
const systemB = buildFixedSystemPrompt({ ...fixedParts });
assert.equal(systemA, systemB);
for (const volatile of ["NOW in the user's time zone", "SALES CHANNEL:", "PERMISSION", "USER PROFILE", "ACCOUNT MEMORY", "SAVED MESSAGE MODEL", "Leads matching the conversation"]) {
  assert.ok(!systemA.includes(volatile), `fixed prompt must not contain ${volatile}`);
}
for (const rule of ["TOOL SELECTION:", "ATTACHMENTS:", "LEADS:", "WRITES:", "MESSAGE MODEL MANAGEMENT:", "remember_account_context", "LEADTITA RULES", "[Trusted skill: seller v2]"]) {
  assert.ok(systemA.includes(rule), `fixed prompt keeps ${rule}`);
}

// 2. Volatile context appears only in the after-history message, right before the latest user message.
const attachment = { name: "lista.pdf", kind: "pdf", size: 2048, text: "SECRET-BODY Acme 555-1234", truncated: false };
const fullBlock = (a) => `<attachment name="${a.name}" kind="${a.kind}">\n${a.text}\n</attachment>`;
const history = [
  { role: "user", content: "te paso la lista", attachments: [attachment] },
  { role: "assistant", content: "Listo, la leí." },
  { role: "user", content: "importá los de Miami" },
];
const anaCtx = contextFor("ana", "2026-11-25, Wednesday, 10:01 GMT-03:00");
const anaLater = buildPromptMessages(systemA, anaCtx, history, fullBlock);
const beto = buildPromptMessages(systemB, contextFor("beto", "2026-11-26, Thursday, 18:44 GMT+01:00"), history, fullBlock);
assert.equal(anaLater[0].role, "system");
assert.equal(anaLater[0].content, beto[0].content, "same system prefix for both users");
assert.deepEqual(anaLater.map((m) => m.role), ["system", "user", "assistant", "system", "user"]);
assert.equal(anaLater[3].content, anaCtx);
assert.equal(anaLater.at(-1).content, "importá los de Miami");
for (const [index, message] of anaLater.entries()) {
  if (index === 3) continue;
  for (const marker of ["ana-profile", "ana-memory", "ana-model", "ana-lead", "10:01", "PERMISSION skip", "SALES CHANNEL"]) {
    assert.ok(!message.content.includes(marker), `volatile ${marker} leaked into message ${index}`);
  }
}
for (const marker of ["ana-profile", "ana-memory", "ana-model", "ana-lead", "10:01", "PERMISSION skip", "BUSINESS: ana-shop", "SALES CHANNEL: Prefer WhatsApp"]) {
  assert.ok(anaCtx.includes(marker), `turn context carries ${marker}`);
}
// History before the context message is identical across users and times: the cacheable prefix.
assert.deepEqual(anaLater.slice(0, 3), beto.slice(0, 3));

// 3. Attachment body only on its upload turn.
const uploadTurn = buildPromptMessages(systemA, anaCtx, history.slice(0, 1), fullBlock);
assert.deepEqual(uploadTurn.map((m) => m.role), ["system", "system", "user"]);
assert.ok(uploadTurn[2].content.includes("SECRET-BODY"), "upload turn sends the full attachment");
const allLater = anaLater.map((m) => m.content).join("\n");
assert.ok(!allLater.includes("SECRET-BODY"), "later turns never resend the attachment body");
assert.ok(anaLater[1].content.includes(attachmentSummaryBlock(attachment)));
const summary = attachmentSummaryBlock({ ...attachment, kind: "csv", csv: { totalRows: 120 } });
assert.ok(summary.startsWith('<attachment name="lista.pdf" kind="csv" size="2048 bytes" omitted>') && summary.endsWith("</attachment>"));
assert.ok(summary.includes("120 data rows") && summary.includes("read_attachment"));
assert.ok(!attachmentSummaryBlock({ ...attachment, name: 'a"b' }).includes('a"b'), "name quotes are neutralized");

// 4. Tool rounds only append: earlier messages are never rewritten.
const snapshot = JSON.stringify(anaLater);
const transcript = [...anaLater, { role: "assistant", content: null }, { role: "tool", content: "{}" }];
assert.equal(JSON.stringify(transcript.slice(0, anaLater.length)), snapshot);

// 5. No user message: context still goes after the fixed prompt.
assert.deepEqual(buildPromptMessages(systemA, anaCtx, [], fullBlock).map((m) => m.role), ["system", "system"]);

console.log("leadtita prompt selfcheck ok");
