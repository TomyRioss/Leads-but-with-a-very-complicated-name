// Run: node --experimental-strip-types lib/server/subscriptions.selfcheck.mjs
// Mercado Pago webhook: signature check, one credit grant per charge (duplicates/retries), amount guard, status sync.
// No network and no database: PocketBase and fetch are in-memory stubs.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { register } from "node:module";

const stub = `
export class PocketBaseRequestError extends Error { constructor(status) { super("pb " + status); this.status = status; } }
export const isPocketBaseConfigured = () => true;
export const db = { users: { u1: { credits: 10 } }, subscriptions: [], payments: [] };
globalThis.__subsDb = db;
const value = (filter, field) => filter.match(new RegExp(field + ' = "([^"]+)"'))?.[1];
export async function pocketBaseFetch(path, init = {}) {
  const [base, query = ""] = path.split("?");
  const filter = new URLSearchParams(query).get("filter") ?? "";
  const body = init.body ? JSON.parse(init.body) : {};
  if (base === "/api/collections/subscriptions/records") {
    const mp = value(filter, "mp_subscription_id"), ref = value(filter, "external_reference");
    return { items: db.subscriptions.filter((s) => (mp && s.mp_subscription_id === mp) || (ref && s.external_reference === ref)) };
  }
  if (base.startsWith("/api/collections/subscriptions/records/")) return Object.assign(db.subscriptions.find((s) => s.id === base.split("/").pop()), body);
  if (base === "/api/collections/subscription_payments/records") {
    if (db.payments.some((p) => p.payment_id === body.payment_id)) throw new PocketBaseRequestError(400);
    const row = { id: "pay" + db.payments.length, ...body };
    db.payments.push(row);
    return row;
  }
  if (base.startsWith("/api/collections/subscription_payments/records/")) {
    const row = db.payments.find((p) => p.id === base.split("/").pop());
    if (init.method === "DELETE") { db.payments.splice(db.payments.indexOf(row), 1); return {}; }
    return Object.assign(row, body);
  }
  if (base.startsWith("/api/collections/users/records/")) {
    const user = db.users[base.split("/").pop()];
    if (body["credits+"]) user.credits += body["credits+"];
    return user;
  }
  throw new Error("unexpected path " + path);
}`;
const root = new URL("../../", import.meta.url).href;
const hooks = `export async function resolve(specifier, context, next) {
  if (specifier === "@/lib/server/pocketbase") return { url: ${JSON.stringify("data:text/javascript," + encodeURIComponent(stub))}, shortCircuit: true };
  if (specifier.startsWith("@/")) return next(${JSON.stringify(root)} + specifier.slice(2) + ".ts", context);
  return next(specifier, context);
}`;
register("data:text/javascript," + encodeURIComponent(hooks));

process.env.MP_ACCESS_TOKEN = "TEST-token";
process.env.MP_WEBHOOK_SECRET = "secret";
const remote = {
  "/authorized_payments/inv1": { id: 1, preapproval_id: "pre1", transaction_amount: 15000, payment: { id: 900, status: "approved" } },
  "/authorized_payments/inv2": { id: 2, preapproval_id: "pre1", transaction_amount: 1, payment: { id: 901, status: "approved" } },
  "/v1/payments/900": { id: 900, status: "approved", transaction_amount: 15000, metadata: { preapproval_id: "pre1" } },
  "/preapproval/pre1": { id: "pre1", status: "cancelled", external_reference: "leadta_x" },
};
globalThis.fetch = async (url) => {
  const body = remote[new URL(url).pathname];
  return { ok: Boolean(body), status: body ? 200 : 404, json: async () => body };
};

const { isValidWebhookSignature } = await import("./mercadopago.ts");
const { handleMercadoPagoNotification } = await import("./subscriptions.ts");
const db = globalThis.__subsDb;
db.subscriptions.push({ id: "s1", user: "u1", plan_id: "starter", external_reference: "leadta_x", mp_subscription_id: "pre1", status: "pending", price_ars: 15000, monthly_credits: 350 });

// Signature: manifest "id:{data.id lowercased};request-id:{x-request-id};ts:{ts};".
const sign = (manifest) => createHmac("sha256", "secret").update(manifest).digest("hex");
assert.ok(isValidWebhookSignature(`ts=1700000000,v1=${sign("id:abc123;request-id:req-1;ts:1700000000;")}`, "req-1", "ABC123"));
assert.ok(isValidWebhookSignature(`ts=1,v1=${sign("id:9;ts:1;")}`, "", "9"), "missing request-id is left out of the manifest");
assert.equal(isValidWebhookSignature(`ts=1700000000,v1=${sign("id:abc123;request-id:req-1;ts:1700000000;")}`, "req-2", "abc123"), false);
assert.equal(isValidWebhookSignature("ts=1", "req-1", "abc123"), false);
assert.equal(isValidWebhookSignature("", "", ""), false);

// Approved charge: credited once even when MP sends both topics and retries.
await handleMercadoPagoNotification("subscription_authorized_payment", "inv1");
assert.equal(db.users.u1.credits, 360);
assert.equal(db.payments[0].status, "processed");
assert.equal(db.subscriptions[0].status, "authorized", "a paid charge marks the subscription authorized");
await handleMercadoPagoNotification("subscription_authorized_payment", "inv1");
await handleMercadoPagoNotification("payment", "900");
assert.equal(db.users.u1.credits, 360, "duplicates never pay twice");
assert.equal(db.payments.length, 1);

// Amount that doesn't match the subscription price: ignored.
await handleMercadoPagoNotification("subscription_authorized_payment", "inv2");
assert.equal(db.users.u1.credits, 360);

// Preapproval status sync (MP "cancelled" → stored "canceled"); unknown topics are ignored.
await handleMercadoPagoNotification("subscription_preapproval", "pre1");
assert.equal(db.subscriptions[0].status, "canceled");
await handleMercadoPagoNotification("merchant_order", "1");

console.log("subscriptions selfcheck ok");
