// Creates the subscription collections in PocketBase, mirroring pb_migrations/1794092428_add_subscriptions.js.
// Usage: node scripts/apply-subscriptions-schema.mjs [--dry-run]
// Reads POCKETBASE_URL, POCKETBASE_SUPERUSER_EMAIL, POCKETBASE_SUPERUSER_PASSWORD and POCKETBASE_BRIDGE_SECRET (optional)
// from .env.local. Idempotent: collections that already exist are left untouched. Never prints secrets.
import { readFileSync } from "node:fs";

const dryRun = process.argv.includes("--dry-run");
const done = [];
const skipped = [];
const step = (list, message) => list.push(dryRun ? `[dry-run] ${message}` : message);

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
const number = (name, options = {}) => ({ name, type: "number", ...options });
const relation = (name, collectionId) => ({ name, type: "relation", required: true, collectionId, cascadeDelete: true, maxSelect: 1 });
// Collections created through the API do not get created/updated automatically.
const timestamps = [
  { name: "created", type: "autodate", onCreate: true, onUpdate: false },
  { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
];
// All rules null = only superusers (the app talks to PocketBase with the superuser token).
const lockedRules = { listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null };

const auth = await pb("/api/collections/_superusers/auth-with-password", {
  method: "POST",
  body: { identity: env.POCKETBASE_SUPERUSER_EMAIL, password: env.POCKETBASE_SUPERUSER_PASSWORD },
});
token = auth.token;
step(done, "Autenticado como superuser");

const users = await pb("/api/collections/users");

// Creates the collection unless it exists; returns its id (undefined in a dry run when it would be created).
async function ensureCollection(name, build) {
  const existing = await pb(`/api/collections/${name}`, { allow404: true });
  if (existing) {
    step(skipped, `${name} ya existe; no se modifica`);
    return existing.id;
  }
  const definition = build();
  if (dryRun) {
    step(done, `${name} se crearía (${definition.fields.length} campos, ${definition.indexes.length} índices)`);
    return undefined;
  }
  const created = await pb("/api/collections", { method: "POST", body: { type: "base", name, ...definition, ...lockedRules } });
  step(done, `${name} creada`);
  return created.id;
}

const subscriptionsId = await ensureCollection("subscriptions", () => ({
  fields: [
    relation("user", users.id),
    text("plan_id", 24, true),
    text("external_reference", 100, true),
    text("mp_subscription_id", 100),
    text("checkout_url", 2000),
    text("status", 24, true),
    number("price_ars", { min: 0, onlyInt: true }),
    number("monthly_credits", { min: 0, onlyInt: true }),
    ...timestamps,
  ],
  indexes: [
    "CREATE UNIQUE INDEX idx_subscriptions_external_reference ON subscriptions (external_reference)",
    "CREATE UNIQUE INDEX idx_subscriptions_mp_subscription_id ON subscriptions (mp_subscription_id) WHERE mp_subscription_id != ''",
    "CREATE INDEX idx_subscriptions_user_status ON subscriptions (user, status)",
  ],
}));

await ensureCollection("subscription_payments", () => {
  // A dry run does not know the id of a collection it has not created.
  if (!subscriptionsId && !dryRun) throw new Error("No se pudo resolver el id de subscriptions.");
  return {
    fields: [
      relation("subscription", subscriptionsId ?? "(id de subscriptions)"),
      relation("user", users.id),
      text("payment_id", 100, true),
      text("invoice_id", 100),
      text("status", 24, true),
      number("amount_ars", { min: 0 }),
      // Fractional credits, as left by pb_migrations/1794174129_allow_fractional_credits.js.
      number("credits", { min: 0, onlyInt: false }),
      number("balance_before", { min: 0, onlyInt: false }),
      ...timestamps,
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_subscription_payments_payment_id ON subscription_payments (payment_id)",
      "CREATE INDEX idx_subscription_payments_user ON subscription_payments (user)",
    ],
  };
});

await ensureCollection("subscription_checkout_locks", () => ({
  fields: [relation("user", users.id), ...timestamps],
  indexes: ["CREATE UNIQUE INDEX idx_subscription_checkout_locks_user ON subscription_checkout_locks (user)"],
}));

for (const message of done) console.log(`✔ ${message}`);
for (const message of skipped) console.log(`– ${message}`);
