// node scripts/owner-activity-sort-selfcheck.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

// Exercise the actual handler with isolated storage and auth, without production writes.
const source = await readFile(new URL("../app/api/owner/users/route.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
let denied = null;
let activeReads = 0;
let maximumReads = 0;
let failAudit = false;
let users = [];
const calls = [];
const date = (day) => `2026-11-${String(day).padStart(2, "0")} 12:00:00Z`;
const records = { subscriptions: [], lead_batches: [], subscription_payments: [], owner_audit_log: [] };
const filterString = (value) => JSON.stringify(value);
async function read(collection, params, complete) {
  calls.push({ collection, params, complete });
  maximumReads = Math.max(maximumReads, ++activeReads);
  await new Promise((resolve) => setTimeout(resolve, 1));
  activeReads--;
  if (collection === "owner_audit_log" && failAudit) throw new Error("Storage unavailable");
  let items = collection === "users" ? users : records[collection];
  if (collection === "users" && params.filter) {
    const needle = JSON.parse(params.filter.match(/email ~ (".*?")/)[1]);
    items = items.filter((user) => user.email.includes(needle) || (user.name ?? "").includes(needle));
  } else if (collection !== "users") {
    const field = collection === "owner_audit_log" ? "actor_email" : "user";
    items = items.filter((item) => params.filter.includes(`${field} = ${JSON.stringify(item[field])}`));
    const fieldDate = collection === "lead_batches" ? "created_at" : "created";
    items = [...items].sort((a, b) => Date.parse(b[fieldDate]) - Date.parse(a[fieldDate]));
  }
  if (complete) return [...items];
  const perPage = Number(params.perPage ?? 25);
  const page = Number(params.page ?? 1);
  return { items: items.slice((page - 1) * perPage, page * perPage), page, totalItems: items.length, totalPages: Math.ceil(items.length / perPage) };
}
const shared = {
  activeSubscriptionStatuses: ["authorized", "paused", "pending"], filterString,
  listRecords: (collection, params) => read(collection, params, false),
  listAllRecords: (collection, params) => read(collection, params, true),
  normalizeCredits: (value) => value ?? 0, pocketBaseNotReady: () => null,
  resolveSort: (value, columns, fallback) => columns[value] ?? fallback,
  toSubscriptionSummary: (subscription) => ({ id: subscription.id }),
};
const module = { exports: {} };
vm.runInNewContext(code, {
  exports: module.exports, module, URL, console: { error() {} },
  require: (specifier) => {
    if (specifier === "next/server") return { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } };
    if (specifier === "@/lib/server/owner") return { requireOwner: async () => denied };
    if (specifier === "@/lib/server/locale") return { errorTranslator: () => (key) => key };
    if (specifier === "../_shared") return shared;
    throw new Error(`Unexpected import: ${specifier}`);
  },
});
const get = async (query) => module.exports.GET({ url: `https://example.test/api/owner/users?${query}` });
const ids = (response) => Array.from(response.body.items, (user) => user.id);
users = Array.from({ length: 53 }, (_, index) => ({ id: `u${index}`, email: `user${index}@example.test`, created: date(1), updated: date(2) }));
users[0].updated = date(10);
records.lead_batches = Array.from({ length: 205 }, () => ({ user: "u1", created_at: date(8) }));
records.lead_batches.push({ user: "u52", created_at: date(7) });
records.subscription_payments = [{ user: "u51", created: date(11) }];
records.owner_audit_log = [{ actor_email: "user50@example.test", created: date(12) }];
records.subscriptions = [{ id: "latest", user: "u49", created: date(13) }, { id: "older", user: "u49", created: date(3) }];

let response = await get("sort=-lastActivity&perPage=2");
assert.equal(response.status, 200);
assert.deepEqual(ids(response), ["u49", "u50"], "Activity across all sources and chunks is sorted before pagination");
assert.equal(response.body.totalItems, 53);
assert.equal(response.body.totalPages, 27);
assert.equal(response.body.items[0].subscription.id, "latest");
response = await get("sort=-lastActivity&perPage=2&page=2");
assert.deepEqual(ids(response), ["u51", "u0"], "Second page keeps global ordering");
response = await get("sort=lastActivity&perPage=100");
assert.deepEqual(ids(response).slice(-6), ["u52", "u1", "u0", "u51", "u50", "u49"], "Ascending activity includes signals beyond the old 200-record cap");
assert.equal(maximumReads, 4, "External activity reads have bounded concurrency");
assert.ok(calls.filter((call) => call.collection !== "users").every((call) => (call.params.filter.match(/user = |actor_email = /g) ?? []).length <= 50), "Filters are chunked");
response = await get("sort=-lastActivity&q=user52&perPage=1");
assert.deepEqual(ids(response), ["u52"]);
assert.equal(response.body.totalItems, 1, "Search constrains the complete sorted set");
response = await get("sort=-lastActivity&page=100");
assert.equal(response.body.items.length, 0);
assert.equal(response.body.totalItems, 53);
response = await get("sort=unknown&perPage=2");
assert.deepEqual(ids(response), ["u0", "u1"], "Existing database pagination is unchanged for other sorts");
assert.ok(calls.some((call) => call.collection === "users" && !call.complete));
failAudit = true;
assert.equal((await get("sort=-lastActivity")).status, 502, "Incomplete activity data fails instead of silently misordering users");
failAudit = false;
users = [];
response = await get("sort=lastActivity");
assert.equal(response.body.totalItems, 0);
assert.equal(response.body.items.length, 0);
denied = { status: 403 };
const beforeDenied = calls.length;
assert.equal((await get("sort=-lastActivity")).status, 403);
assert.equal(calls.length, beforeDenied, "Authorization runs before any storage reads");
console.log("owner activity sorting selfcheck OK");

