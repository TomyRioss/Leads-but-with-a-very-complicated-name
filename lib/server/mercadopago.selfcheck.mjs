// Run: node lib/server/mercadopago.selfcheck.mjs
// Checks the pure parts of the Mercado Pago integration: webhook signature and status mapping. No network, no database.
import assert from "node:assert/strict";
import { isValidWebhookSignature, toStoredStatus } from "./mercadopago.ts";

// Known vector, computed independently: HMAC-SHA256("test-secret", "id:abc123;request-id:req-1;ts:1700000000000;").
const secret = "test-secret";
const v1 = "1e831687419619941dc5309d1a97f6bcf3cc220e0fcc9f3eb2aef592286bbd06"; // openssl dgst -sha256 -hmac
const input = { signature: `ts=1700000000000,v1=${v1}`, requestId: "req-1", dataId: "abc123" };

assert.equal(isValidWebhookSignature(input, secret), true, "known vector");
assert.equal(isValidWebhookSignature({ ...input, signature: ` ts=1700000000000 , v1=${v1.toUpperCase()} ` }, secret), true, "spaces and hex case are ignored");
assert.equal(isValidWebhookSignature({ ...input, dataId: "ABC123" }, secret), true, "data.id goes lowercase");
assert.equal(isValidWebhookSignature({ ...input, dataId: "abc124" }, secret), false, "other resource");
assert.equal(isValidWebhookSignature({ ...input, requestId: "req-2" }, secret), false, "other request id");
assert.equal(isValidWebhookSignature({ ...input, signature: `ts=1700000000001,v1=${v1}` }, secret), false, "other ts");
assert.equal(isValidWebhookSignature({ ...input, signature: "" }, secret), false, "missing signature");
assert.equal(isValidWebhookSignature({ ...input, signature: "ts=1,v1=abc" }, secret), false, "wrong length does not throw");
assert.equal(isValidWebhookSignature({ ...input, signature: `v1=${v1}` }, secret), false, "missing ts");
assert.equal(isValidWebhookSignature(input, ""), false, "no secret configured");

assert.deepEqual(
  ["authorized", "paused", "cancelled", "finished", "pending", undefined].map(toStoredStatus),
  ["authorized", "paused", "canceled", "canceled", "creating", "creating"],
);

console.log("mercadopago selfcheck ok");
