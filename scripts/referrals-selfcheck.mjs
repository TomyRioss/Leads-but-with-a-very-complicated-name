// Headless self-check of the pure referral logic: node --experimental-strip-types scripts/referrals-selfcheck.mjs
import assert from "node:assert/strict";
import { canRefer, generateReferralCode, isValidReferralCode, maskEmail, MAX_REWARDS_PER_MONTH, monthStartIso, normalizeEmail, rewardDecision } from "../lib/server/referrals.ts";

const codes = new Set(Array.from({ length: 5000 }, generateReferralCode));
assert.equal(codes.size, 5000, "codes are unique");
for (const code of codes) assert.ok(isValidReferralCode(code) && code.length === 8);
assert.ok(!isValidReferralCode("abc") && !isValidReferralCode("ILOU0000"));

assert.equal(normalizeEmail("Jo.Hn+x@Gmail.com"), "john@gmail.com");
assert.equal(normalizeEmail("a.b@work.com"), "a.b@work.com");
assert.ok(!canRefer({ id: "1", email: "a@x.com" }, { id: "1", email: "b@x.com" }), "self id");
assert.ok(!canRefer({ id: "1", email: "j.ohn@gmail.com" }, { id: "2", email: "john+2@gmail.com" }), "same normalized email");
assert.ok(canRefer({ id: "1", email: "a@x.com" }, { id: "2", email: "b@x.com" }));

assert.equal(rewardDecision("pending", 0), "reward");
assert.equal(rewardDecision("rewarded", 0), "skip", "idempotent: already rewarded");
assert.equal(rewardDecision("rejected", 0), "skip");
assert.equal(rewardDecision("pending", MAX_REWARDS_PER_MONTH - 1), "reward");
assert.equal(rewardDecision("pending", MAX_REWARDS_PER_MONTH), "reject_monthly_cap");
assert.equal(monthStartIso(new Date("2026-11-12T10:00:00Z")), "2026-11-01 00:00:00.000Z");
assert.equal(maskEmail("john@gmail.com"), "j***@gmail.com");
console.log("referrals self-check OK");
