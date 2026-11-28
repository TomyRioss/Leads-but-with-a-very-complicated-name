// Run: node lib/server/subscriptions.selfcheck.mjs
// isAlreadyClaimed: only PocketBase's unique-index 400 counts as "payment already credited"; any other error must propagate.
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";

const root = pathToFileURL(new URL("../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")).href;
const hooks = `export async function resolve(specifier, context, next) {
  // PocketBase and email stubbed: this check never touches the database or the network.
  if (specifier === "@/lib/server/pocketbase") return { url: "data:text/javascript," + encodeURIComponent("const no = async () => { throw new Error('no db in selfcheck'); }; export class PocketBaseRequestError extends Error { constructor(message, status, detail = '') { super(message); this.status = status; this.detail = detail; } } export const pocketBaseFetch = no;"), shortCircuit: true };
  if (specifier === "@/lib/server/email") return { url: "data:text/javascript,export const sendSubscriptionReceiptEmail = async () => {};", shortCircuit: true };
  if (specifier.startsWith("@/")) return next(${JSON.stringify(root)} + specifier.slice(2) + ".ts", context);
  return next(specifier, context);
}`;
register(`data:text/javascript,${encodeURIComponent(hooks)}`);

const { PocketBaseRequestError } = await import("@/lib/server/pocketbase");
const { isAlreadyClaimed } = await import("./subscriptions.ts");

const unique = JSON.stringify({ status: 400, message: "Failed to create record.", data: { payment_id: { code: "validation_not_unique", message: "Value must be unique." } } });
const required = JSON.stringify({ status: 400, message: "Failed to create record.", data: { user: { code: "validation_required", message: "Cannot be blank." } } });

assert.equal(isAlreadyClaimed(new PocketBaseRequestError("dup", 400, unique)), true, "unique payment_id = already credited");
assert.equal(isAlreadyClaimed(new PocketBaseRequestError("bad", 400, required)), false, "other validation 400 must propagate");
assert.equal(isAlreadyClaimed(new PocketBaseRequestError("bad", 400, "")), false, "400 without detail must propagate");
assert.equal(isAlreadyClaimed(new PocketBaseRequestError("down", 500, unique)), false, "non-400 must propagate");
assert.equal(isAlreadyClaimed(new Error("validation_not_unique")), false, "non-PocketBase error must propagate");
assert.equal(isAlreadyClaimed(undefined), false);

console.log("subscriptions selfcheck ok");
