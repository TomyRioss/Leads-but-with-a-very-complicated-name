// Self-check headless: node --experimental-strip-types lib/lead-rules.selfcheck.mjs
import assert from "node:assert/strict";
import { isFreeTopUp, matchesLeadRules, parseLeadRules } from "./lead-rules.ts";

const chile = parseLeadRules([{ field: "phone", op: "starts_with", value: "+56" }]);
assert.deepEqual(chile, [{ field: "phone", op: "starts_with", value: "+56" }]);
assert.equal(matchesLeadRules({ phone: "+56 9 1234 5678" }, chile), true);
assert.equal(matchesLeadRules({ phone: "56-9-1234" }, chile), true);
assert.equal(matchesLeadRules({ phone: "+54 11 4444" }, chile), false);
assert.equal(matchesLeadRules({ phone: "" }, chile), false);

// JSON string (signed card) round-trips; AND across rules; accents/case ignored.
const combo = parseLeadRules(JSON.stringify([{ field: "email", op: "not_empty" }, { field: "name", op: "not_contains", value: "Café" }]));
assert.equal(matchesLeadRules({ email: "a@b.cl", name: "Inmobiliaria Sur" }, combo), true);
assert.equal(matchesLeadRules({ email: "a@b.cl", name: "CAFE Norte" }, combo), false);
assert.equal(matchesLeadRules({ email: "", name: "Sur" }, combo), false);
assert.equal(matchesLeadRules({ website: "" }, parseLeadRules([{ field: "website", op: "empty" }])), true);

// Invalid input is rejected whole, never partially applied.
assert.deepEqual(parseLeadRules(undefined), []);
assert.equal(parseLeadRules([{ field: "phone", op: "starts_with", value: "+" }]), null);
assert.equal(parseLeadRules([{ field: "rating", op: "contains", value: "4" }]), null);
assert.equal(parseLeadRules([{ field: "name", op: "regex", value: "x" }]), null);
assert.equal(parseLeadRules([{ field: "name", op: "contains" }]), null);
assert.equal(parseLeadRules(Array(4).fill({ field: "email", op: "empty" })), null);
assert.equal(parseLeadRules("{bad"), null);

// Free top-up: rounds 1-2 and shortfall 1-49 only.
assert.equal(isFreeTopUp(1, 5), true);
assert.equal(isFreeTopUp(2, 49), true);
assert.equal(isFreeTopUp(3, 5), false);
assert.equal(isFreeTopUp(1, 50), false);
assert.equal(isFreeTopUp(1, 0), false);

console.log("lead-rules selfcheck ok");
