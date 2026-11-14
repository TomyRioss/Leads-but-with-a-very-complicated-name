// Headless self-check: node --experimental-strip-types lib/server/people/sources/marketplaces.selfcheck.mjs
// Items con la forma real de los actores (Fiverr y Thumbtack capturados en corrida real; Behance según el ejemplo del README,
// el actor respondió "data source unavailable" en las corridas de prueba).
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
registerHooks({
  resolve(specifier, context, next) {
    const base = specifier.startsWith("@/") ? pathToFileURL(root + specifier.slice(2)).href
      : specifier.startsWith(".") && context.parentURL ? new URL(specifier, context.parentURL).href : null;
    if (base && !/\.[cm]?[jt]s$/.test(base) && existsSync(fileURLToPath(base + ".ts"))) return next(base + ".ts", context);
    return next(specifier, context);
  },
});

const { mapFiverrSeller, mapBehanceUser, behanceCountryOf } = await import("./marketplaces.ts");
const plan = { role: "Desarrollador React", location: "Argentina" };

// 1. Fiverr (salida real, requireContact: solo contactSignals.websites)
const fiverrReal = {
  success: true, inputUrl: "https://www.fiverr.com/dksengine", username: "dksengine", displayName: "Dks", tagline: "Don't fight against the future",
  bio: "Hi! I'm a software developer skilled in React... Contact me to discuss your project! https://dksengine.com ... Read more",
  location: "Italy", ratingValue: 4.4, reviewsCountNum: 7, profileUrl: "https://www.fiverr.com/dksengine",
  contactSignals: { websites: ["https://dksengine.com"] }, primaryNiche: "web development",
};
const f = mapFiverrSeller(fiverrReal, plan);
assert.equal(f.source, "fiverr");
assert.equal(f.website, "https://dksengine.com");
assert.equal(f.location, "Italy", "país del vendedor");
assert.equal(f.sourceUrl, "https://www.fiverr.com/dksengine");
assert.equal(f.name, "Dks");
assert.match(f.snippet, /4\.4★ \(7 reviews\)/);
const f2 = mapFiverrSeller({ ...fiverrReal, location: "", bio: "", contactSignals: { emails: ["Dev@Studio.io", "logo@2x.png"], socials: ["https://www.linkedin.com/in/dks", "https://github.com/dks"] } }, plan);
assert.equal(f2.email, "dev@studio.io");
assert.equal(f2.location, "Argentina", "fallback plan.location");
assert.deepEqual(f2.socialProfiles, { linkedin: "https://www.linkedin.com/in/dks" });
assert.equal(f2.website, "", "la web sale solo de contactSignals.websites");
assert.equal(mapFiverrSeller({ ...fiverrReal, bio: "", contactSignals: {} }, plan), null, "sin contacto → null");
assert.equal(mapFiverrSeller({ ...fiverrReal, success: false }, plan), null);

// 2. Behance (forma del README)
const behanceItem = {
  type: "designer", userId: 990211441, username: "designerabutalha", name: "Abu Talha ✪", url: "https://www.behance.net/designerabutalha",
  company: "Freelance", location: "Córdoba", country: "Argentina", followers: 6010, availableForHire: true,
  socialLinks: ["http://instagram.com/logodesigner_abutalha", "http://twitter.com/logodesignart", "https://www.linkedin.com/profile-thirdparty-redirect/abc"],
  instagram: "http://instagram.com/logodesigner_abutalha", twitter: "http://twitter.com/logodesignart", linkedin: "https://www.linkedin.com/profile-thirdparty-redirect/abc",
  dribbble: "http://dribbble.com/designerabutalha", facebook: "http://facebook.com/designerabutalha", youtube: null, otherLinks: ["https://dribbble.com/x", "https://abutalha.design"],
};
const b = mapBehanceUser(behanceItem, plan);
assert.equal(b.source, "behance");
assert.equal(b.email, "");
assert.equal(b.website, "https://abutalha.design", "portfolio propio, no dribbble");
assert.equal(b.location, "Córdoba, Argentina");
assert.equal(b.socialProfiles.instagram, "https://instagram.com/logodesigner_abutalha", "http → https");
assert.equal(b.socialProfiles.facebook, "https://facebook.com/designerabutalha");
assert.ok(b.socialProfiles.linkedin);
assert.equal(b.sourceUrl, "https://www.behance.net/designerabutalha");
assert.equal(mapBehanceUser({ ...behanceItem, location: "USA", country: "United States" }, plan).location, "USA, United States");
const onlySocial = mapBehanceUser({ ...behanceItem, otherLinks: [] }, plan);
assert.equal(onlySocial.website, "", "sin web propia igual devuelve con redes");
assert.equal(mapBehanceUser({ ...behanceItem, socialLinks: ["http://twitter.com/x"], instagram: null, linkedin: null, facebook: null, otherLinks: ["https://dribbble.com/x"] }, plan), null, "ni web ni red soportada → null");
assert.equal(behanceCountryOf("Palermo, Buenos Aires, Argentina"), "Argentina");
assert.equal(behanceCountryOf(""), "");


console.log("marketplaces self-check OK");
