// Headless self-check of the Instagram contact actor mapping (no network).
// Run: node --experimental-strip-types lib/server/people/sources/instagram.selfcheck.mjs
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";

const root = pathToFileURL(`${process.cwd()}/`).href;
const loader = `
export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(${JSON.stringify(root)} + specifier.slice(2) + ".ts", context);
  return next(specifier, context);
}`;
register(`data:text/javascript,${encodeURIComponent(loader)}`);

const { mapInstagramContact, instagramKeywords, searchInstagram } = await import("./instagram.ts");
const plan = { role: "entrenador personal", location: "Córdoba, Argentina" };

// email/phone como string, whatsapp como link, ciudad del actor, links sociales en bioLinks.
const coach = mapInstagramContact({
  username: "lucas.fit",
  fullName: "Lucas Pérez",
  profileUrl: "https://www.instagram.com/lucas.fit",
  followers: 2310,
  isPrivate: false,
  isBusiness: true,
  category: "Entrenador personal",
  biography: "Entrenamiento funcional y online",
  externalUrl: "https://lucasfit.com.ar",
  bioLinks: [{ url: "https://wa.me/5493515551234" }, "https://www.youtube.com/@lucasfit"],
  facebookUrl: "https://www.facebook.com/lucasfit",
  email: "Lucas@Gmail.com",
  phone: "+54 9 351 555-1234",
  city: "Córdoba",
}, plan);
assert.equal(coach.email, "lucas@gmail.com");
assert.equal(coach.phone, "+5493515551234");
assert.equal(coach.whatsapp, "+5493515551234");
assert.equal(coach.website, "https://lucasfit.com.ar");
assert.equal(coach.role, "Entrenador personal");
assert.equal(coach.location, "Córdoba");
assert.equal(coach.source, "instagram");
assert.equal(coach.sourceUrl, "https://www.instagram.com/lucas.fit");
assert.equal(coach.socialProfiles.instagram, "https://www.instagram.com/lucas.fit");
assert.equal(coach.socialProfiles.facebook, "https://www.facebook.com/lucasfit");
assert.equal(coach.socialProfiles.youtube, "https://www.youtube.com/@lucasfit");
assert.equal(coach.isBusiness, false, "actor isBusiness flag ignored");
assert.match(coach.snippet, /2310 followers/);

// emails/phones como arrays, publicPhone con country code, whatsapp numérico, sin ciudad → plan.location.
const arrays = mapInstagramContact({
  username: "gym_norte_srl",
  fullName: "Gym Norte SRL",
  email: ["no-valido", "contacto@gymnorte.com"],
  phones: ["123", "0351 4223344"],
  whatsapp: "+54 9 351 600-0000",
  externalUrl: "https://wa.me/5493516000000",
}, plan);
assert.equal(arrays.email, "contacto@gymnorte.com");
assert.equal(arrays.phone, "03514223344");
assert.equal(arrays.whatsapp, "+5493516000000");
assert.equal(arrays.website, "", "wa.me is not a website");
assert.equal(arrays.location, "Córdoba, Argentina");
assert.equal(arrays.role, "entrenador personal");
assert.equal(arrays.isBusiness, true);
assert.equal(arrays.sourceUrl, "https://www.instagram.com/gym_norte_srl");

const publicPhone = mapInstagramContact({ username: "ana", emails: [], publicPhone: "3515550000", publicPhoneCountryCode: "54" }, plan);
assert.equal(publicPhone.phone, "+543515550000");
assert.equal(publicPhone.email, "");

assert.equal(mapInstagramContact({ message: "Keyword done", contactFound: 0 }, plan), null, "diagnostic row skipped");
assert.equal(mapInstagramContact({ username: "x", isPrivate: true, email: "x@y.com" }, plan), null, "private skipped");

// Keywords: ciudad agregada, sin duplicar, máx 3; fallback a hashtags y rol.
assert.deepEqual(instagramKeywords({ ...plan, keywords: ["entrenador personal", "personal trainer cordoba", "coach fitness", "yoga"], instagramQueries: [] }),
  ["entrenador personal Córdoba", "personal trainer cordoba", "coach fitness Córdoba"]);
assert.deepEqual(instagramKeywords({ ...plan, keywords: [], instagramQueries: ["#entrenadorcordoba"] }), ["entrenadorcordoba"]);
assert.deepEqual(instagramKeywords({ ...plan, keywords: [], instagramQueries: [] }), ["entrenador personal Córdoba"]);

// Sin token: no rompe, devuelve [].
delete process.env.APIFY_TOKEN;
assert.deepEqual(await searchInstagram({ ...plan, keywords: ["entrenador personal"], instagramQueries: [], facebookGroupQueries: [] }), []);

console.log("instagram selfcheck ok");
