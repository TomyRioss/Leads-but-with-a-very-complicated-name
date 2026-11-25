import assert from "node:assert/strict";
import { pickProposalChannels } from "./channel-mix.ts";

const lead = (id, { whatsapp = "", phone = "", email = "" } = {}) =>
  ({ id, name: id, category: "", address: "", phone, whatsapp, email, website: "", maps_url: "", average_rating: "", review_count: "" });
const count = (picks, channel) => picks.filter((pick) => pick.channel === channel).length;
const distinct = (picks) => new Set(picks.map((pick) => pick.lead.id)).size === picks.length;

// 1. Mostly WhatsApp: 10 picks, at least 2 Gmail, minority prefers leads without WhatsApp.
const mostlyWa = [
  ...Array.from({ length: 12 }, (_, i) => lead(`w${i}`, { whatsapp: `54911${i}`, phone: `+54911${i}` })),
  lead("both", { whatsapp: "5491100", email: "both@x.com" }),
  lead("m1", { email: "m1@x.com" }),
  lead("m2", { email: "m2@x.com" }),
  lead("m3", { email: "m3@x.com" }),
];
let picks = pickProposalChannels(mostlyWa, 10, 2);
assert.equal(picks.length, 10);
assert.ok(distinct(picks));
assert.equal(count(picks, "gmail"), 2);
assert.deepEqual(picks.filter((p) => p.channel === "gmail").map((p) => p.lead.id), ["m1", "m2"]);
assert.ok(picks.every((p) => (p.channel === "gmail" ? p.to.includes("@") : p.to.length > 0)));

// 2. Mostly email: at least 2 WhatsApp; a landline phone is not WhatsApp.
const mostlyMail = [
  ...Array.from({ length: 15 }, (_, i) => lead(`e${i}`, { email: `e${i}@x.com` })),
  lead("p1", { phone: "+5491122223333" }),
  lead("p2", { whatsapp: "5491144445555" }),
  lead("p3", { whatsapp: "5491166667777" }),
];
picks = pickProposalChannels(mostlyMail, 10, 2);
assert.equal(picks.length, 10);
assert.equal(count(picks, "whatsapp"), 2);
assert.equal(count(picks, "gmail"), 8);
assert.ok(!picks.some((p) => p.lead.id === "p1"));

// 3. Only one lead has the minority channel: use it, the rest go majority.
picks = pickProposalChannels([...Array.from({ length: 12 }, (_, i) => lead(`w${i}`, { whatsapp: `1${i}` })), lead("only", { email: "o@x.com" })], 10, 2);
assert.equal(picks.length, 10);
assert.equal(count(picks, "gmail"), 1);

// 4. Not enough majority leads: fill with the minority channel; never duplicates.
picks = pickProposalChannels([lead("a", { whatsapp: "1" }), lead("b", { whatsapp: "2", email: "b@x.com" }), lead("c", { email: "c@x.com" }), lead("a", { whatsapp: "1" })], 10, 2);
assert.equal(picks.length, 3);
assert.ok(distinct(picks));

// 5. Leads without any channel are skipped; invalid emails don't count.
picks = pickProposalChannels([lead("x"), lead("y", { email: "not-an-email" }), lead("z", { phone: "+5491100001111" }), lead("w", { whatsapp: "5491100002222" })], 10, 2);
assert.deepEqual(picks.map((p) => [p.lead.id, p.channel]), [["w", "whatsapp"]]);

// 6. Deterministic.
assert.deepEqual(pickProposalChannels(mostlyWa, 10, 2), pickProposalChannels(mostlyWa, 10, 2));

console.log("channel-mix selfcheck ok");
