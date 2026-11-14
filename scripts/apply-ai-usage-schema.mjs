// Creates the ai_usage collection in PocketBase, mirroring pb_migrations/1794410000_add_ai_usage.js.
// Usage: node scripts/apply-ai-usage-schema.mjs [--dry-run]
// Reads POCKETBASE_URL, POCKETBASE_SUPERUSER_EMAIL, POCKETBASE_SUPERUSER_PASSWORD and POCKETBASE_BRIDGE_SECRET (optional)
// from .env.local. Idempotent: an existing collection is left untouched. Never prints secrets.
import { readFileSync } from "node:fs";

const dryRun = process.argv.includes("--dry-run");

function loadEnv() {
  const env = {};
  try {
    for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match || line.trimStart().startsWith("#")) continue;
      env[match[1]] = match[2].trim().replace(/^(["'])(.*)\1$/, "$2");
    }
  } catch {
    throw new Error("No se pudo leer .env.local (ejecutá el script desde la raíz del proyecto).");
  }
  return env;
}

const env = loadEnv();
const missing = ["POCKETBASE_URL", "POCKETBASE_SUPERUSER_EMAIL", "POCKETBASE_SUPERUSER_PASSWORD"].filter((key) => !env[key]);
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

const users = await pb("/api/collections/users");
const definition = {
  type: "base",
  name: "ai_usage",
  fields: [
    { name: "feature", type: "text", required: true, max: 40 },
    { name: "model", type: "text", max: 120 },
    { name: "user", type: "relation", required: false, collectionId: users.id, cascadeDelete: false, maxSelect: 1 },
    { name: "prompt_tokens", type: "number", onlyInt: true, min: 0 },
    { name: "completion_tokens", type: "number", onlyInt: true, min: 0 },
    { name: "cost_usd", type: "number", min: 0 },
    { name: "created_at", type: "autodate", onCreate: true, onUpdate: false },
  ],
  indexes: [
    "CREATE INDEX idx_ai_usage_created_at ON ai_usage (created_at)",
    "CREATE INDEX idx_ai_usage_feature_created_at ON ai_usage (feature, created_at)",
  ],
  // All rules null = only superusers (the server).
  listRule: null,
  viewRule: null,
  createRule: null,
  updateRule: null,
  deleteRule: null,
};

const prefix = dryRun ? "[dry-run] " : "";
if (await pb("/api/collections/ai_usage", { allow404: true })) {
  console.log(`${prefix}– ai_usage ya existe; no se modifica`);
} else {
  if (!dryRun) await pb("/api/collections", { method: "POST", body: definition });
  console.log(`${prefix}✔ ai_usage ${dryRun ? "se crearía" : "creada"} (${definition.fields.length} campos, ${definition.indexes.length} índices)`);
}
