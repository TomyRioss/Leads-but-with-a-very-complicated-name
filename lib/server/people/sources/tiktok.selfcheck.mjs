// Headless self-check: node --experimental-strip-types lib/server/people/sources/tiktok.selfcheck.mjs
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

// Resuelve el alias "@/..." y los imports sin extensión hacia los .ts del repo (solo para este script).
const root = fileURLToPath(new URL("../../../../", import.meta.url));
registerHooks({
  resolve(specifier, context, next) {
    const base = specifier.startsWith("@/") ? pathToFileURL(root + specifier.slice(2)).href
      : specifier.startsWith(".") && context.parentURL ? new URL(specifier, context.parentURL).href : null;
    if (base && !/\.[cm]?[jt]s$/.test(base) && existsSync(fileURLToPath(base + ".ts"))) return next(base + ".ts", context);
    return next(specifier, context);
  },
});

const { mapTiktokCreator, tiktokKeywords, socialUrl } = await import("./tiktok.ts");
const plan = { role: "influencer fitness", location: "Córdoba, Argentina" };

// Forma real del actor (deepmine/tiktok-email-scraper): nulls en redes vacías, emails como array.
const base = {
  username: "valeriaarzaba", nickname: "Valeria Arzaba", followers: 4105, likes: 90000, videos: 120,
  email: "ValeriaCollabs@icloud.com", emailSource: "bio", emails: ["valeriacollabs@icloud.com"],
  bioLink: "https://www.instagram.com/valeria_arzaba?igsh=abc", instagram: "https://www.instagram.com/valeria_arzaba",
  youtube: null, phones: null, facebook: null, x: null, linkedin: null, whatsapp: null, telegram: null,
  bio: "Holi soy Valu\nfitness y recetas", bioSnippet: "Holi soy Valu", profileUrl: "https://www.tiktok.com/@valeriaarzaba",
  isVerified: false, isCommerceAccount: true, businessCategory: null, isSeller: true, language: "es",
};

// 1. Creador con email e Instagram en URL
const a = mapTiktokCreator(base, plan);
assert.equal(a.source, "tiktok");
assert.equal(a.sourceUrl, "https://www.tiktok.com/@valeriaarzaba");
assert.equal(a.name, "Valeria Arzaba");
assert.equal(a.email, "valeriacollabs@icloud.com", "email en minúsculas");
assert.equal(a.role, "influencer fitness", "fallback al rol del plan");
assert.equal(a.location, "Córdoba, Argentina");
assert.equal(a.website, "", "bioLink de Instagram no es sitio web");
assert.deepEqual(a.socialProfiles, { instagram: "https://www.instagram.com/valeria_arzaba" });
assert.match(a.snippet, /fitness y recetas · 4105 followers/);
assert.equal(a.isBusiness, false, "isSeller/isCommerceAccount solos no marcan negocio");

// 2. Handles, teléfono, WhatsApp, sitio propio, categoría, negocio por nombre
const b = mapTiktokCreator({
  ...base, username: "gymfit.srl", nickname: "", profileUrl: "", email: "", emails: [],
  instagram: "@gymfit.cba", youtube: "gymfitcba", linkedin: "https://www.linkedin.com/company/gymfit",
  phones: ["+54 9 351 555-1234"], whatsapp: "https://wa.me/5493515551234", bioLink: "gymfit.com.ar/planes",
  businessCategory: "Gimnasio",
}, plan);
assert.equal(b.name, "gymfit.srl", "fallback a username");
assert.equal(b.sourceUrl, "https://www.tiktok.com/@gymfit.srl");
assert.equal(b.email, "");
assert.equal(b.phone, "+5493515551234");
assert.equal(b.whatsapp, "+5493515551234");
assert.equal(b.website, "https://gymfit.com.ar/planes");
assert.equal(b.role, "Gimnasio");
assert.deepEqual(b.socialProfiles, {
  instagram: "https://www.instagram.com/gymfit.cba",
  youtube: "https://www.youtube.com/@gymfitcba",
  linkedin: "https://www.linkedin.com/company/gymfit",
});
assert.equal(b.isBusiness, true, "srl en username");

// 3. Sin email válido ni teléfono ni WhatsApp → null; sin username → null
assert.equal(mapTiktokCreator({ ...base, email: "logo@2x.png", emails: ["nope"] }, plan), null);
assert.equal(mapTiktokCreator({ ...base, email: null, emails: null }, plan), null);
assert.equal(mapTiktokCreator({ ...base, username: "" }, plan), null);
// Solo WhatsApp como número suelto alcanza
assert.equal(mapTiktokCreator({ ...base, email: "", emails: [], whatsapp: "+54 9 351 444 0000" }, plan).whatsapp, "+5493514440000");
// bioLink wa.me / linktree de red no va a website
assert.equal(mapTiktokCreator({ ...base, bioLink: "https://wa.me/5493515551234" }, plan).website, "");

// 4. socialUrl: URLs de otra red o handles inválidos se descartan
assert.equal(socialUrl("https://www.tiktok.com/@x", "instagram"), "");
assert.equal(socialUrl("http://instagram.com/foo", "instagram"), "https://instagram.com/foo");
assert.equal(socialUrl("con espacios", "youtube"), "");
assert.equal(socialUrl("@juan", "linkedin"), "", "linkedin sin handle base");

// 5. Keywords: ciudad agregada, fallback al rol, sin duplicar la ciudad
assert.deepEqual(tiktokKeywords({ ...plan, keywords: ["fitness", " "] }), ["fitness Córdoba"]);
assert.deepEqual(tiktokKeywords({ ...plan, keywords: [] }), ["influencer fitness Córdoba"]);
assert.deepEqual(tiktokKeywords({ role: "coach", location: "", keywords: ["coach cordoba", "yoga"] }), ["coach cordoba", "yoga"]);
assert.deepEqual(tiktokKeywords({ ...plan, location: "Córdoba", keywords: ["fitness córdoba"] }), ["fitness córdoba"]);

console.log("tiktok selfcheck OK");
