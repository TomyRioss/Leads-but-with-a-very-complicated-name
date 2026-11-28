// Self-check headless: node --experimental-strip-types lib/server/whatsapp-check.selfcheck.mjs
import assert from "node:assert/strict";
import { FREE_TOPUP_MAX_ROUNDS, isFreeTopUp, isWaReplaceAllowed, WA_REPLACE_MAX_ROUNDS } from "../lead-rules.ts";

const cap = FREE_TOPUP_MAX_ROUNDS + WA_REPLACE_MAX_ROUNDS;
// A new batch (topup_rounds 0) can always replace, also after its free top-ups or a filter that exhausted them.
assert.equal(isWaReplaceAllowed(1), true);
assert.equal(isWaReplaceAllowed(FREE_TOPUP_MAX_ROUNDS + 1), true);
assert.equal(isWaReplaceAllowed(cap), true);
// The round past the cap is rejected (before any search runs).
assert.equal(isWaReplaceAllowed(cap + 1), false);
assert.equal(isWaReplaceAllowed(100), false);
// Malformed rounds never pass.
for (const round of [0, -1, 1.5, Number.NaN]) assert.equal(isWaReplaceAllowed(round), false);
// Normal free top-ups keep their own rule.
assert.equal(isFreeTopUp(FREE_TOPUP_MAX_ROUNDS, 10), true);
assert.equal(isFreeTopUp(FREE_TOPUP_MAX_ROUNDS + 1, 10), false);

console.log("whatsapp-check selfcheck ok");
