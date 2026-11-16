// Run: node --experimental-strip-types lib/server/scheduled-messages.selfcheck.mjs
// parseSendAt: "Programar" only accepts dates 30 s to 90 days ahead.
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

const { parseSendAt } = await import("./scheduled-messages.ts");

const now = Date.UTC(2026, 10, 16, 12, 0, 0);
const at = (ms) => new Date(now + ms).toISOString();
assert.equal(parseSendAt(at(2 * 60 * 60_000), now), at(2 * 60 * 60_000));
assert.equal(parseSendAt("2026-11-16T11:00:00-03:00", now), "2026-11-16T14:00:00.000Z"); // offsets normalized to UTC
assert.equal(parseSendAt(at(10_000), now), null); // too soon
assert.equal(parseSendAt(at(-60_000), now), null); // past
assert.equal(parseSendAt(at(91 * 24 * 60 * 60_000), now), null); // beyond 90 days
for (const bad of ["", "mañana", 123, null, undefined, "x".repeat(41)]) assert.equal(parseSendAt(bad, now), null);
console.log("scheduled-messages selfcheck ok");
