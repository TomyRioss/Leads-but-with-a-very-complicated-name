// Seeds the single owner user in PocketBase. Usage: node scripts/seed-owner.mjs [--dry-run] [--reset-password]
// Reads POCKETBASE_URL, POCKETBASE_SUPERUSER_EMAIL, POCKETBASE_SUPERUSER_PASSWORD, POCKETBASE_BRIDGE_SECRET (optional),
// OWNER_EMAIL and OWNER_PASSWORD from .env.local. Never prints passwords or tokens.
import { readFileSync } from "node:fs";

const dryRun = process.argv.includes("--dry-run");
const resetPassword = process.argv.includes("--reset-password");
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
const required = ["POCKETBASE_URL", "POCKETBASE_SUPERUSER_EMAIL", "POCKETBASE_SUPERUSER_PASSWORD", "OWNER_EMAIL", "OWNER_PASSWORD"];
const missing = required.filter((key) => !env[key]);
if (missing.length) throw new Error(`Faltan variables en .env.local: ${missing.join(", ")}`);

const baseUrl = env.POCKETBASE_URL.replace(/\/$/, "");
const ownerEmail = env.OWNER_EMAIL;
const bridge = env.POCKETBASE_BRIDGE_SECRET ? { "X-Leadta-Bridge-Key": env.POCKETBASE_BRIDGE_SECRET } : {};
const indexName = "idx_users_single_owner";
const indexSql = `CREATE UNIQUE INDEX ${indexName} ON users (role) WHERE role = 'owner'`;
const createRule = "@request.body.credits = 240 && @request.body.role:isset = false";

let token = "";
async function pb(path, { method = "GET", body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...bridge, ...(token ? { Authorization: token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`PocketBase respondió ${response.status} en ${method} ${path.split("?")[0]}: ${data.message ?? "sin detalle"}`);
  return data;
}

const quote = (value) => `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
const findUsers = (filter) => pb(`/api/collections/users/records?perPage=2&fields=id,email,role&filter=${encodeURIComponent(filter)}`).then((page) => page.items);

// a. superuser
const auth = await pb("/api/collections/_superusers/auth-with-password", {
  method: "POST",
  body: { identity: env.POCKETBASE_SUPERUSER_EMAIL, password: env.POCKETBASE_SUPERUSER_PASSWORD },
});
token = auth.token;
step(done, "Autenticado como superuser");

// b. schema
const users = await pb("/api/collections/users");
const patch = {};
const hasRole = users.fields.some((field) => field.name === "role");
if (!hasRole) patch.fields = [...users.fields, { name: "role", type: "select", values: ["user", "owner"], maxSelect: 1, required: false }];
if (!(users.indexes ?? []).some((index) => index.includes(indexName))) patch.indexes = [...(users.indexes ?? []), indexSql];
if (users.createRule !== createRule) patch.createRule = createRule;
if (Object.keys(patch).length) {
  if (!dryRun) await pb("/api/collections/users", { method: "PATCH", body: patch });
  step(done, `Esquema users actualizado (${Object.keys(patch).join(", ")})`);
} else {
  step(skipped, "Esquema users ya estaba al día");
}

// c. existing owners (the role field may not exist yet in a dry run)
const owners = hasRole || !dryRun ? await findUsers(`role = "owner"`) : [];
const foreignOwner = owners.find((user) => user.email.toLowerCase() !== ownerEmail.toLowerCase());
if (foreignOwner) throw new Error("Ya existe un owner con otro email. Solo puede haber un owner; revisalo manualmente.");

// d. create / promote
const [existing] = await findUsers(`email = ${quote(ownerEmail)}`);
let ownerId = existing?.id ?? "";
if (!existing) {
  if (!dryRun) {
    const created = await pb("/api/collections/users/records", {
      method: "POST",
      body: {
        email: ownerEmail,
        password: env.OWNER_PASSWORD,
        passwordConfirm: env.OWNER_PASSWORD,
        emailVisibility: true,
        verified: true,
        name: "Leadta Staff",
        credits: 0,
        role: "owner",
      },
    });
    ownerId = created.id;
  }
  step(done, "Usuario owner creado");
} else {
  const update = {};
  if (existing.role !== "owner") update.role = "owner";
  if (resetPassword) Object.assign(update, { password: env.OWNER_PASSWORD, passwordConfirm: env.OWNER_PASSWORD });
  if (Object.keys(update).length) {
    if (!dryRun) await pb(`/api/collections/users/records/${existing.id}`, { method: "PATCH", body: update });
    step(done, `Usuario existente actualizado (${Object.keys(update).filter((key) => key !== "passwordConfirm").map((key) => (key === "password" ? "contraseña" : key)).join(", ")})`);
  } else {
    step(skipped, "El owner ya existía; contraseña sin cambios (usá --reset-password para cambiarla)");
  }
}

// e. summary
console.log(`Owner id: ${ownerId || "(se asignará al crearlo)"}`);
for (const message of done) console.log(`✔ ${message}`);
for (const message of skipped) console.log(`– ${message}`);
