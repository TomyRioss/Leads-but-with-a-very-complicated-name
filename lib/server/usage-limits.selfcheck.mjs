// Self-check for free usage limits. No network: "@/lib/server/pocketbase" is replaced by an in-memory stub.
// Run: node --experimental-strip-types lib/server/usage-limits.selfcheck.mjs
import assert from "node:assert/strict";
import { register } from "node:module";

const stub = `
export const db = { used: { free_pain_analyses_used: 0, free_enrichments_used: 0 }, plan: false };
globalThis.__usageDb = db;
export async function pocketBaseFetch(path, init = {}) {
  if (path.startsWith("/api/collections/subscriptions/records")) return { totalItems: db.plan ? 1 : 0, items: db.plan ? [{ plan_id: db.plan }] : [] };
  if (path.startsWith("/api/collections/users/records/")) {
    if (init.method === "PATCH") {
      for (const [key, value] of Object.entries(JSON.parse(init.body))) {
        const field = key.slice(0, -1);
        db.used[field] += key.endsWith("+") ? value : -value;
      }
    }
    return { ...db.used };
  }
  throw new Error("unexpected path " + path);
}`;
const hooks = `
export async function resolve(specifier, context, next) {
  if (specifier === "@/lib/server/pocketbase") return { url: ${JSON.stringify("data:text/javascript," + encodeURIComponent(stub))}, shortCircuit: true };
  if (specifier.startsWith("@/")) return next(${JSON.stringify(new URL("../../", import.meta.url).href)} + specifier.slice(2) + ".ts", context);
  return next(specifier, context);
}`;
register("data:text/javascript," + encodeURIComponent(hooks));

const { reserveFreeUsage, getFreeUsage, getPlanLimits, FREE_PAIN_ANALYSIS_LIMIT, FREE_ENRICHMENT_LIMIT } =
  await import(new URL("./usage-limits.ts", import.meta.url).href);
const db = globalThis.__usageDb;
const user = { id: "u1", role: "user" };

assert.equal(FREE_PAIN_ANALYSIS_LIMIT, 100);
assert.equal(FREE_ENRICHMENT_LIMIT, 100);

// Remaining quota.
db.used.free_pain_analyses_used = 40;
assert.equal((await getFreeUsage("u1", "pain_points")).remaining, 60);

// Partial batch: 95 used, 10 requested → 5 granted; only completed ones count.
db.used.free_pain_analyses_used = 95;
let r = await reserveFreeUsage(user, "pain_points", 10);
assert.equal(r.granted, 5);
assert.equal(db.used.free_pain_analyses_used, 100, "reserved upfront");
await r.settle(3);
assert.equal(db.used.free_pain_analyses_used, 98, "unfinished items refunded");
await r.settle(0);
assert.equal(db.used.free_pain_analyses_used, 98, "settle is idempotent");

// Exhausted quota → nothing granted, counter untouched.
db.used.free_enrichments_used = 100;
r = await reserveFreeUsage(user, "enrichment", 4);
assert.equal(r.granted, 0);
assert.equal(db.used.free_enrichments_used, 100);

// Errors: zero completed → full refund.
db.used.free_enrichments_used = 10;
r = await reserveFreeUsage(user, "enrichment", 4);
await r.settle(0);
assert.equal(db.used.free_enrichments_used, 10);

// Concurrency: two reservations racing past the cap never leave the counter above the limit.
db.used.free_pain_analyses_used = 90;
const [a, b] = await Promise.all([reserveFreeUsage(user, "pain_points", 10), reserveFreeUsage(user, "pain_points", 10)]);
assert.ok(a.granted + b.granted <= 10);
assert.ok(db.used.free_pain_analyses_used <= 100);

// Plan and owner: unlimited, counter untouched.
db.plan = true;
db.used.free_pain_analyses_used = 100;
r = await reserveFreeUsage(user, "pain_points", 50);
assert.equal(r.unlimited, true);
assert.equal(r.granted, Infinity);
db.plan = false;
r = await reserveFreeUsage({ id: "u1", role: "owner" }, "pain_points", 50);
assert.equal(r.unlimited, true);
assert.equal(db.used.free_pain_analyses_used, 100);

// Plan caps: Starter / Growth from the catalog, unknown active plan → Growth caps, no plan → free caps.
const caps = async (plan) => { db.plan = plan; const { whatsappMonthly, emailMonthly, scheduledMonthly, hasPlan } = await getPlanLimits("u1"); return [whatsappMonthly, emailMonthly, scheduledMonthly, hasPlan]; };
assert.deepEqual(await caps("starter"), [150, 150, 20, true]);
assert.deepEqual(await caps("growth"), [500, 500, 50, true]);
assert.deepEqual(await caps("legacy-custom"), [500, 500, 50, true]);
assert.deepEqual(await caps(false), [100, Infinity, 10, false]);

console.log("usage-limits selfcheck ok");
