import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { register } from "node:module";
import { pathToFileURL } from "node:url";

// Resolve the "@/..." alias (tsconfig paths) to project .ts files so the server modules load under plain Node.
// PocketBase is stubbed: these checks never touch the database (and its file uses syntax strip-types can't run).
const root = pathToFileURL(new URL("../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")).href;
const hooks = `export async function resolve(specifier, context, next) {
  if (specifier === "@/lib/server/pocketbase") return { url: "data:text/javascript,export async function pocketBaseFetch(){throw new Error('no db in selfcheck')}", shortCircuit: true };
  if (specifier.startsWith("@/")) return next(${JSON.stringify(root)} + specifier.slice(2) + ".ts", context);
  if (specifier.startsWith(".") && !specifier.split("/").pop().includes(".")) return next(specifier + ".ts", context);
  return next(specifier, context);
}`;
register(`data:text/javascript,${encodeURIComponent(hooks)}`);


process.env.EMAIL_VERIFICATION_SECRET = "selfcheck-secret";
const { createEmailVerificationToken, createPasswordResetToken, readEmailVerificationToken, readPasswordResetToken } = await import("./email.ts");

const user = { id: "abc123def456gh", email: "Ana@Example.com", updated: "2026-11-17 10:00:00.000Z" };
const reset = createPasswordResetToken(user);
assert.deepEqual(readPasswordResetToken(reset), { id: user.id, email: "ana@example.com", v: user.updated });

// Tampered payload or signature rejected.
const [payload, signature] = reset.split(".");
const forged = Buffer.from(JSON.stringify({ id: user.id, email: "ana@example.com", v: user.updated, exp: 9999999999 })).toString("base64url");
assert.equal(readPasswordResetToken(`${forged}.${signature}`), null);
assert.equal(readPasswordResetToken(`${payload}.${signature.slice(0, -1)}A`), null);
assert.equal(readPasswordResetToken(`${reset}.x`), null);

// Purposes don't cross: a verification link is never a reset link, and vice versa.
const verify = createEmailVerificationToken(user, "es");
assert.ok(readEmailVerificationToken(verify));
assert.equal(readPasswordResetToken(verify), null);
assert.equal(readEmailVerificationToken(reset), null);

console.log("password-reset selfcheck ok");
