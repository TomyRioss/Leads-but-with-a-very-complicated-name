import assert from "node:assert/strict";
import { completenessOf, hasContact, CREDITS_PER_PERSON } from "./people.ts";

assert.equal(CREDITS_PER_PERSON, 4);
assert.equal(completenessOf({ whatsapp: "", email: "", socialProfiles: {} }, false), 0);
assert.equal(completenessOf({ whatsapp: "+54911", email: "", socialProfiles: {} }, false), 1);
assert.equal(completenessOf({ whatsapp: "+54911", email: "a@b.com", socialProfiles: { instagram: "https://instagram.com/x" } }, true), 4);
assert.equal(completenessOf({ whatsapp: " ", email: "a@b.com", socialProfiles: { facebook: "  " } }, true), 2);
assert.equal(completenessOf({ whatsapp: "", email: "", socialProfiles: undefined }, true), 1);

assert.equal(hasContact({ phone: "", whatsapp: "", email: "" }), false);
assert.equal(hasContact({ phone: "  ", whatsapp: "", email: "" }), false);
assert.equal(hasContact({ phone: "011 4444", whatsapp: "", email: "" }), true);
assert.equal(hasContact({ phone: "", whatsapp: "+54911", email: "" }), true);
assert.equal(hasContact({ phone: "", whatsapp: "", email: "a@b.com" }), true);
console.log("people selfcheck ok");
