// Run: node --experimental-strip-types lib/server/batch-review.selfcheck.mjs
// withBatchReview: a reviewed batch send only keeps a subset of the signed rows, with validated edits.
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";

const root = pathToFileURL(new URL("../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")).href;
const hooks = `export async function resolve(specifier, context, next) {
  // PocketBase stubbed: this check never touches the database.
  if (specifier === "@/lib/server/pocketbase") return { url: "data:text/javascript," + encodeURIComponent("const no = async () => { throw new Error('no db in selfcheck'); }; export class PocketBaseRequestError extends Error {} export class PocketBaseAuthError extends Error {} export const isPocketBaseConfigured = () => false; export const pocketBaseFetch = no, pocketBasePublicFetch = no, createLeadRecords = no;"), shortCircuit: true };
  if (specifier === "next/server") return next("next/server.js", context);
  if (specifier.startsWith("@/")) return next(${JSON.stringify(root)} + specifier.slice(2) + ".ts", context);
  return next(specifier, context);
}`;
register(`data:text/javascript,${encodeURIComponent(hooks)}`);

const { withBatchReview } = await import("./leadtita-tools.ts");

const A = "aaaaaaaaaaaaaaa";
const B = "bbbbbbbbbbbbbbb";
const email = { kind: "send_email_batch", extra: { count: 2 }, rows: [
  { leadId: A, leadName: "A", to: "a@x.com", subject: "Hola A", body: "Texto A" },
  { leadId: B, leadName: "B", to: "b@x.com", subject: "Hola B", body: "Texto B" },
] };
const wa = { kind: "send_whatsapp_batch", extra: { count: 2 }, rows: [
  { leadId: A, leadName: "A", phone: "5491100000000", text: "Hola A" },
  { leadId: B, leadName: "B", phone: "5491100000001", text: "Hola B" },
] };

// No review: unchanged.
assert.equal(withBatchReview(email, undefined), email);

// Drop a recipient + edit the other; destination stays the signed one.
const kept = withBatchReview(email, [{ leadId: B, subject: " Nuevo ", body: "Editado", to: "evil@x.com" }]);
assert.deepEqual(kept.rows, [{ leadId: B, leadName: "B", to: "b@x.com", subject: "Nuevo", body: "Editado" }]);
assert.equal(kept.extra.count, 1);

const waKept = withBatchReview(wa, [{ leadId: A, text: "Cambio", phone: "1" }]);
assert.deepEqual(waKept.rows, [{ leadId: A, leadName: "A", phone: "5491100000000", text: "Cambio" }]);

// Rejected: unknown lead, duplicate, empty list, empty text, too long, wrong kind.
assert.equal(withBatchReview(email, [{ leadId: "ccccccccccccccc", subject: "x", body: "y" }]), null);
assert.equal(withBatchReview(email, [{ leadId: A, subject: "x", body: "y" }, { leadId: A, subject: "x", body: "y" }]), null);
assert.equal(withBatchReview(email, []), null);
assert.equal(withBatchReview(email, [{ leadId: A, subject: "x", body: "   " }]), null);
assert.equal(withBatchReview(wa, [{ leadId: A, text: "x".repeat(1501) }]), null);
assert.equal(withBatchReview({ ...email, kind: "send_email" }, [{ leadId: A, subject: "x", body: "y" }]), null);
assert.equal(withBatchReview(email, "nope"), null);

console.log("batch-review selfcheck ok");
