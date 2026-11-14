// Self-check for people enrichment/filtering and the 4-credits-per-delivered settle. No network.
// Run: node --experimental-strip-types lib/server/people/enrich.selfcheck.mjs
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";

const root = pathToFileURL(process.cwd() + "/").href;
const scrapeStub = `
export * from ${JSON.stringify(root + "lib/server/contact-scrape.ts")};
export async function scrapeWebsite(url) {
  if (url.includes("ana.com.ar")) return { email: { value: "ana@ana.com.ar", source_url: url }, socials: { instagram: { value: "https://instagram.com/ana", source_url: url } }, pagesRead: [url] };
  return { socials: {}, pagesRead: [] };
}`;
const pbStub = `export async function pocketBaseFetch() { throw new Error("no network"); }`;
const hooks = `
const root = ${JSON.stringify(root)};
export async function resolve(specifier, context, next) {
  if (specifier === "@/lib/server/contact-scrape" && !context.parentURL?.startsWith("data:")) return { url: ${JSON.stringify("data:text/javascript," + encodeURIComponent(scrapeStub))}, shortCircuit: true };
  if (specifier === "@/lib/server/pocketbase") return { url: ${JSON.stringify("data:text/javascript," + encodeURIComponent(pbStub))}, shortCircuit: true };
  if (specifier.startsWith("@/")) return { url: root + specifier.slice(2) + ".ts", shortCircuit: true };
  return next(specifier, context);
}`;
register("data:text/javascript," + encodeURIComponent(hooks));

const { enrichCandidates, filterPeople, whatsappFrom, isPersonalPage } = await import(new URL("./enrich.ts", import.meta.url).href);
const { settleCredits } = await import(new URL("../credits.ts", import.meta.url).href);
const { CREDITS_PER_PERSON, completenessOf } = await import(new URL("../../people.ts", import.meta.url).href);

const person = (overrides) => ({ name: "X", role: "", location: "", phone: "", whatsapp: "", email: "", website: "", socialProfiles: {}, source: "serper", sourceUrl: "", snippet: "", ...overrides });

// wa.me from Argentine mobiles and explicit links; landlines and unknown countries stay empty.
assert.equal(whatsappFrom("+54 9 11 2345-6789"), "https://wa.me/5491123456789");
assert.equal(whatsappFrom("https://api.whatsapp.com/send?phone=5491123456789"), "https://wa.me/5491123456789");
assert.equal(whatsappFrom("+54 11 4567-8901"), "");
assert.equal(whatsappFrom("11 2345 6789"), "");

// Personal pages only.
assert.equal(isPersonalPage("https://www.mercadolibre.com.ar/x"), false);
assert.equal(isPersonalPage("https://instagram.com/ana"), false);
assert.equal(isPersonalPage("https://ana.com.ar"), true);

// Filter: businesses and people without contact are dropped; duplicates by email/phone/URL are merged.
const filtered = filterPeople([
  person({ name: "Empresa", email: "info@srl.com", isBusiness: true }),
  person({ name: "Sin contacto", socialProfiles: { instagram: "https://instagram.com/nadie" } }),
  person({ name: "Juan", phone: "+54 9 11 2345-6789" }),
  person({ name: "Juan bis", whatsapp: "https://wa.me/5491123456789", email: "JUAN@mail.com" }),
  person({ name: "Luz", email: "luz@mail.com", sourceUrl: "https://luz.com/" }),
  person({ name: "Luz bis", email: "otra@mail.com", sourceUrl: "https://www.luz.com" }),
]);
assert.deepEqual(filtered.map((p) => p.name), ["Juan", "Luz"]);
assert.equal(filtered[0].whatsapp, "https://wa.me/5491123456789");
assert.equal(filtered[0].email, "juan@mail.com", "duplicate fills missing email");

// Completeness: WhatsApp + email + social (+ pains) → 0..4; most complete first.
assert.equal(completenessOf(filtered[0], false), 2);
assert.equal(completenessOf({ whatsapp: "x", email: "y", socialProfiles: { instagram: "z" } }, true), 4);

// Enrichment reads the personal site and fills email + socials.
const enriched = await enrichCandidates([
  person({ name: "Ana", phone: "+54 9 11 9999-0000", website: "https://ana.com.ar" }),
  person({ name: "Mute", website: "https://mercadolibre.com.ar/mute" }),
]);
assert.equal(enriched.length, 1);
assert.equal(enriched[0].email, "ana@ana.com.ar");
assert.equal(enriched[0].socialProfiles.instagram, "https://instagram.com/ana");
assert.equal(completenessOf(enriched[0], false), 3);

// Credits: reserve 4 × count, charge 4 × delivered, refund the rest.
assert.equal(CREDITS_PER_PERSON, 4);
assert.deepEqual(settleCredits(4 * 10, 4 * 7), { charged: 28, refund: 12 });
assert.deepEqual(settleCredits(4 * 10, 0), { charged: 0, refund: 40 });
assert.deepEqual(settleCredits(4 * 5, 4 * 9), { charged: 20, refund: 0 });

console.log("people enrich selfcheck ok");
