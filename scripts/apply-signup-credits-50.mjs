// Sets the users create rule to require 50 signup credits, mirroring pb_migrations/1794480000_set_signup_credits_50.js.
// Usage: node scripts/apply-signup-credits-50.mjs [--dry-run]
// Reads PocketBase credentials from .env.local. Idempotent and never prints secrets.
import { readFileSync } from "node:fs";

const dryRun = process.argv.includes("--dry-run");
const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (!match || line.trimStart().startsWith("#")) continue;
  env[match[1]] = match[2].trim().replace(/^("|')(.*)\1$/, "$2");
}

const required = ["POCKETBASE_URL", "POCKETBASE_SUPERUSER_EMAIL", "POCKETBASE_SUPERUSER_PASSWORD"];
const missing = required.filter((key) => !env[key]);
if (missing.length) throw new Error(`Faltan variables en .env.local: ${missing.join(", ")}`);

const baseUrl = env.POCKETBASE_URL.replace(/\/$/, "");
const bridge = env.POCKETBASE_BRIDGE_SECRET ? { "X-Leadta-Bridge-Key": env.POCKETBASE_BRIDGE_SECRET } : {};
let token = "";
async function pb(path, { method = "GET", body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...bridge, ...(token ? { Authorization: token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`PocketBase respondió ${response.status} en ${method} ${path}: ${data.message ?? "sin detalle"}`);
  return data;
}

const auth = await pb("/api/collections/_superusers/auth-with-password", {
  method: "POST",
  body: { identity: env.POCKETBASE_SUPERUSER_EMAIL, password: env.POCKETBASE_SUPERUSER_PASSWORD },
});
token = auth.token;

const prefix = dryRun ? "[dry-run] " : "";
const users = await pb("/api/collections/users");
const current = users.createRule ?? "";
console.log(`${prefix}regla actual: ${current || "(null)"}`);
if (current.includes("@request.body.credits = 50")) {
  console.log(`${prefix}ya exige 50 créditos; no se modifica`);
} else if (!current.includes("@request.body.credits = 240")) {
  throw new Error("La regla no contiene '@request.body.credits = 240'; revisala a mano antes de cambiarla.");
} else {
  const next = current.replace("@request.body.credits = 240", "@request.body.credits = 50");
  console.log(`${prefix}regla nueva:  ${next}`);
  if (!dryRun) {
    await pb(`/api/collections/${users.id}`, { method: "PATCH", body: { createRule: next } });
    console.log("regla actualizada");
  }
}
