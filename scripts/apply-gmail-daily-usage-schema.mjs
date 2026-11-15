// Creates the gmail_daily_usage collection in PocketBase, mirroring its migration.
// Usage: node scripts/apply-gmail-daily-usage-schema.mjs [--dry-run]
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
async function pb(path, { method = "GET", body, allow404 = false } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...bridge, ...(token ? { Authorization: token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (allow404 && response.status === 404) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`PocketBase respondió ${response.status} en ${method} ${path.split("?")[0]}: ${data.message ?? "sin detalle"}`);
  return data;
}

const auth = await pb("/api/collections/_superusers/auth-with-password", {
  method: "POST",
  body: { identity: env.POCKETBASE_SUPERUSER_EMAIL, password: env.POCKETBASE_SUPERUSER_PASSWORD },
});
token = auth.token;

const prefix = dryRun ? "[dry-run] " : "";
if (await pb("/api/collections/gmail_daily_usage", { allow404: true })) {
  console.log(`${prefix}gmail_daily_usage ya existe; no se modifica`);
} else {
  const users = await pb("/api/collections/users");
  const definition = {
    type: "base",
    name: "gmail_daily_usage",
    fields: [
      { name: "user", type: "relation", required: true, collectionId: users.id, cascadeDelete: false, maxSelect: 1 },
      { name: "day", type: "text", required: true, min: 10, max: 10 },
      { name: "used", type: "number", required: true, min: 0, onlyInt: true },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_gmail_daily_usage_user_day ON gmail_daily_usage (user, day)"],
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
  };
  if (!dryRun) await pb("/api/collections", { method: "POST", body: definition });
  console.log(`${prefix}gmail_daily_usage ${dryRun ? "se crearía" : "creada"}`);
}
