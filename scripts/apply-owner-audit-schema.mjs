// Creates the owner_audit_log collection in PocketBase, mirroring pb_migrations/1794300000_add_owner_audit_log.js.
// Usage: node scripts/apply-owner-audit-schema.mjs [--dry-run]
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

const text = (name, max, required = false) => ({ name, type: "text", required, max });
const definition = {
  type: "base",
  name: "owner_audit_log",
  fields: [
    text("actor_email", 200),
    text("action", 60, true),
    text("target_type", 30),
    text("target_id", 40),
    text("target_label", 300),
    { name: "details", type: "json", maxSize: 20000 },
    text("ip", 64),
    // Collections created through the API do not get created/updated automatically.
    { name: "created", type: "autodate", onCreate: true, onUpdate: false },
    { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
  ],
  indexes: [
    "CREATE INDEX idx_owner_audit_log_created ON owner_audit_log (created)",
    "CREATE INDEX idx_owner_audit_log_action ON owner_audit_log (action)",
    "CREATE INDEX idx_owner_audit_log_target_id ON owner_audit_log (target_id)",
  ],
  // All rules null = only superusers.
  listRule: null,
  viewRule: null,
  createRule: null,
  updateRule: null,
  deleteRule: null,
};

const auth = await pb("/api/collections/_superusers/auth-with-password", {
  method: "POST",
  body: { identity: env.POCKETBASE_SUPERUSER_EMAIL, password: env.POCKETBASE_SUPERUSER_PASSWORD },
});
token = auth.token;

const prefix = dryRun ? "[dry-run] " : "";
if (await pb("/api/collections/owner_audit_log", { allow404: true })) {
  console.log(`${prefix}– owner_audit_log ya existe; no se modifica`);
} else {
  if (!dryRun) await pb("/api/collections", { method: "POST", body: definition });
  console.log(`${prefix}✔ owner_audit_log ${dryRun ? "se crearía" : "creada"} (${definition.fields.length} campos, ${definition.indexes.length} índices)`);
}
