// Run: node --experimental-strip-types lib/server/rebill.selfcheck.mjs
// Checks the pure parts of the Rebill integration: webhook signature, status mapping, plan id map. No network, no database.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { isValidWebhookSignature, leadtaPlanId, rebillPlanIds, toStoredStatus } from "./rebill.ts";

const secret = `whsec_${"a1".repeat(32)}`;
const body = JSON.stringify({ data: { id: "test_sub_1" }, webhook: { event: "subscription.updated", logId: "log_1" } });
const signature = createHmac("sha256", secret).update(body).digest("hex");

assert.equal(isValidWebhookSignature(signature, body, secret), true);
assert.equal(isValidWebhookSignature(signature.toUpperCase(), body, secret), true, "hex case is ignored");
assert.equal(isValidWebhookSignature(signature, `${body} `, secret), false, "body tampering");
assert.equal(isValidWebhookSignature("", body, secret), false, "missing signature");
assert.equal(isValidWebhookSignature("abc", body, secret), false, "wrong length does not throw");
assert.equal(isValidWebhookSignature(signature, body, ""), false, "no secret configured");

assert.deepEqual(["active", "retrying", "paused", "cancelled", "finished", "processing", undefined].map(toStoredStatus), ["authorized", "authorized", "paused", "canceled", "canceled", "pending", "pending"]);

process.env.REBILL_PLAN_IDS = "starter=pln_s, growth=pln_g ,broken,=x";
assert.deepEqual(rebillPlanIds(), { starter: "pln_s", growth: "pln_g" });
assert.equal(leadtaPlanId("pln_g"), "growth");
assert.equal(leadtaPlanId("pln_other"), undefined);

console.log("rebill selfcheck ok");
