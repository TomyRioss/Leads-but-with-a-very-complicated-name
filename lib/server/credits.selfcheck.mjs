// Self-check for credit reserve/settle/release. No network: "@/lib/server/pocketbase" is replaced by an in-memory stub.
// Run: node --experimental-strip-types lib/server/credits.selfcheck.mjs
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";

const stub = `
export const db = { credits: 0, locks: new Map(), nextId: 1, failRefund: false, patches: 0 };
globalThis.__creditsDb = db;
export async function pocketBaseFetch(path, init = {}) {
  const method = init.method || "GET";
  if (path.startsWith("/api/collections/credit_locks/records")) {
    if (method === "POST") {
      if (db.locks.size > 0) throw new Error("unique");
      const id = String(db.nextId++); db.locks.set(id, new Date().toISOString()); return { id };
    }
    if (method === "DELETE") { db.locks.delete(path.split("/").pop()); return {}; }
    const [id, created] = [...db.locks][0] || [];
    return { items: id ? [{ id, created }] : [] };
  }
  if (path.startsWith("/api/collections/users/records/")) {
    if (method === "PATCH") {
      db.patches++;
      const body = JSON.parse(init.body);
      const next = "credits" in body ? body.credits : db.credits + (body["credits+"] ?? 0) - (body["credits-"] ?? 0);
      if (db.failRefund && next > db.credits) throw new Error("refund failed");
      db.credits = next; return { id: "u1", credits: db.credits };
    }
    return { id: "u1", credits: db.credits };
  }
  throw new Error("unexpected path " + path);
}`;
const stubUrl = "data:text/javascript," + encodeURIComponent(stub);
const hooks = `
const root = ${JSON.stringify(pathToFileURL(process.cwd() + "/").href)};
export async function resolve(specifier, context, next) {
  if (specifier === "@/lib/server/pocketbase") return { url: ${JSON.stringify(stubUrl)}, shortCircuit: true };
  return next(specifier, context);
}`;
register("data:text/javascript," + encodeURIComponent(hooks));

const { settleCredits, reserveLeadCredits, CREDITS_PER_LEAD, InsufficientCreditsError, CreditOperationBusyError } =
  await import(new URL("./credits.ts", import.meta.url).href);
const db = globalThis.__creditsDb;

// Pure math: requested N leads, delivered M → charge 2M, refund 2(N−M).
assert.equal(CREDITS_PER_LEAD, 2);
for (const [n, m] of [[10, 10], [10, 7], [10, 0], [150, 100]]) {
  assert.deepEqual(settleCredits(2 * n, 2 * m), { charged: 2 * m, refund: 2 * (n - m) });
}
assert.deepEqual(settleCredits(20, 99), { charged: 20, refund: 0 }, "never charge above reservation");
assert.deepEqual(settleCredits(20, -5), { charged: 0, refund: 20 });
assert.deepEqual(settleCredits(20, NaN), { charged: 0, refund: 20 });

async function run(start, leads, fn) {
  db.credits = start; db.locks.clear(); db.failRefund = false;
  const r = await reserveLeadCredits("u1", leads);
  assert.equal(db.credits, start - leads * CREDITS_PER_LEAD, "reserve debits upfront");
  try { await fn(r); } finally { await r.release().catch(() => undefined); }
  assert.equal(db.locks.size, 0, "lock released");
  return db.credits;
}

// Partial delivery: 10 requested, 7 saved → charge 14.
assert.equal(await run(100, 10, (r) => r.settle(7)), 86);
// Double settle (route success path then catch) → no double refund.
assert.equal(await run(100, 10, async (r) => { await r.settle(7); await r.settle(0); }), 86);
// Error after reserve, never settled → release refunds everything.
assert.equal(await run(100, 10, async () => { throw new Error("apify down"); }).catch(() => db.credits), 100);
// Settle then release → release does not refund again.
assert.equal(await run(100, 10, (r) => r.settle(10)), 80);
// Settle clamps persisted above requested.
assert.equal(await run(100, 5, (r) => r.settle(50)), 90);

// Refund failure inside release still frees the lock.
db.credits = 100; db.locks.clear(); db.failRefund = true;
const failing = await reserveLeadCredits("u1", 5);
await assert.rejects(failing.release());
assert.equal(db.locks.size, 0, "lock freed even when refund fails");
db.failRefund = false;

// Concurrency: second reservation while first holds the lock → busy, balance untouched.
db.credits = 100; db.locks.clear();
const first = await reserveLeadCredits("u1", 10);
await assert.rejects(reserveLeadCredits("u1", 10), CreditOperationBusyError);
assert.equal(db.credits, 80);
await first.settle(3); await first.release();
assert.equal(db.credits, 94);

// Lock-free referral reward ("credits+") during a search is not overwritten by settle.
db.credits = 100; db.locks.clear();
const withReward = await reserveLeadCredits("u1", 10);
db.credits += 30; // referrals.ts PATCH {"credits+": 30} lands mid-search
assert.equal(await withReward.settle(4), 122, "100 - 8 charged + 30 reward");
await withReward.release();
assert.equal(db.credits, 122);

// Insufficient credits → nothing debited, lock freed.
db.credits = 3; db.locks.clear();
await assert.rejects(reserveLeadCredits("u1", 5), InsufficientCreditsError);
assert.equal(db.credits, 3);
assert.equal(db.locks.size, 0);

console.log("credits selfcheck ok");
