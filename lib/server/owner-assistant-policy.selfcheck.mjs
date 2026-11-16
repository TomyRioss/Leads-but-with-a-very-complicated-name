// Self-check for the Leadtita Staff permission rule and signed proposals. No network.
// Run: node --experimental-strip-types lib/server/owner-assistant-policy.selfcheck.mjs
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

process.env.EMAIL_VERIFICATION_SECRET = "selfcheck-secret";
const { OWNER_CHANGE_KINDS, autoRunAllowed, requiresCard, runsWithoutCard, signOwnerChange, verifyOwnerChange, OWNER_PENDING_TTL_MS } =
  await import(new URL("./owner-assistant-policy.ts", import.meta.url).href);

// ---- Permission matrix: which kinds run without a card in each mode ----
const low = [
  ["update_user", { userId: "u1", name: "Ana" }],
  ["update_user", { userId: "u1", phone: "+54 11" }],
  ["create_blog_post", { title: "T", status: "draft" }],
  ["update_blog_post", { postId: "p1", title: "T", live: false }],
];
const carded = [
  ["adjust_credits", { userId: "u1", mode: "add", amount: 10 }],
  ["delete_user", { userId: "u1" }],
  ["subscription_status", { subscriptionId: "s1", status: "paused" }],
  ["close_feedback", { feedbackId: "f1" }],
  ["delete_batch", { batchId: "b1" }],
  ["delete_blog_post", { postId: "p1" }],
  ["update_user", { userId: "u1", email: "a@b.co" }],
  ["create_blog_post", { title: "T", status: "published" }],
  ["update_blog_post", { postId: "p1", status: "published", live: false }],
  ["update_blog_post", { postId: "p1", title: "T", live: true }],
  ["unknown_kind", {}],
];
for (const [kind, args] of low) {
  assert.equal(requiresCard(kind, args), false, `${kind} low risk`);
  assert.equal(runsWithoutCard("ask", kind, args), false);
  assert.equal(runsWithoutCard("skip", kind, args), true);
  assert.equal(runsWithoutCard("danger", kind, args), true);
}
for (const [kind, args] of carded) {
  assert.equal(requiresCard(kind, args), true, `${kind} needs a card`);
  assert.equal(runsWithoutCard("ask", kind, args), false);
  assert.equal(runsWithoutCard("skip", kind, args), false, `${kind} never auto-runs in skip`);
  assert.equal(runsWithoutCard("danger", kind, args), true);
}
// Every write kind except profile/blog edits is carded with any args.
for (const kind of OWNER_CHANGE_KINDS.filter((kind) => !["update_user", "create_blog_post", "update_blog_post"].includes(kind))) assert.equal(requiresCard(kind, {}), true, kind);

// ---- Server gate for automatic confirms ----
const del = ["delete_user", { userId: "u1" }];
const name = ["update_user", { userId: "u1", name: "Ana" }];
assert.equal(autoRunAllowed(undefined, "ask", ...del), true, "an explicit Yes always runs");
assert.equal(autoRunAllowed("skip", "skip", ...name), true);
assert.equal(autoRunAllowed("skip", "skip", ...del), false, "skip can't unlock a carded kind");
assert.equal(autoRunAllowed("skip", "danger", ...name), true, "less permissive claim is fine");
assert.equal(autoRunAllowed("danger", "skip", ...del), false, "claim can't exceed the signed mode");
assert.equal(autoRunAllowed("danger", "ask", ...name), false);
assert.equal(autoRunAllowed("skip", "ask", ...name), false, "ask proposals never auto-run");
assert.equal(autoRunAllowed("danger", "danger", ...del), true);
assert.equal(autoRunAllowed("ask", "danger", ...name), false);
assert.equal(autoRunAllowed("bogus", "danger", ...name), false);

// ---- Tokens ----
const now = 1_800_000_000_000;
const token = signOwnerChange({ uid: "owner1", kind: "delete_batch", args: { batchId: "b1" }, perm: "ask" }, now);
assert.ok(token.startsWith("oa1."));
const payload = verifyOwnerChange(token, "owner1", now + 1000);
assert.equal(payload?.kind, "delete_batch");
assert.deepEqual(payload?.args, { batchId: "b1" });
assert.equal(payload?.perm, "ask");
assert.equal(verifyOwnerChange(token, "someone-else", now), null, "bound to the owner id");
assert.equal(verifyOwnerChange(token, "owner1", now + OWNER_PENDING_TTL_MS + 1), null, "expires");
const [prefix, body, signature] = token.split(".");
const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), perm: "danger" })).toString("base64url");
assert.equal(verifyOwnerChange(`${prefix}.${forged}.${signature}`, "owner1", now), null, "payload can't be edited");
assert.equal(verifyOwnerChange(`${body}.${signature}`, "owner1", now), null, "user Leadtita token shape is rejected");
assert.equal(verifyOwnerChange(`${prefix}.${body}.${signature}x`, "owner1", now), null);
assert.equal(verifyOwnerChange(null, "owner1", now), null);

// A token signed with the user Leadtita key (different purpose) never verifies here.
const userKey = createHmac("sha256", "selfcheck-secret").update("leadta:lead-suite-pending-change:v1").digest();
const userSig = createHmac("sha256", userKey).update(`oa1.${body}`).digest("base64url");
assert.equal(verifyOwnerChange(`oa1.${body}.${userSig}`, "owner1", now), null, "user Leadtita key can't sign owner changes");

console.log("owner-assistant-policy selfcheck: ok");
