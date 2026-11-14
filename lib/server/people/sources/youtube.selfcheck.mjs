// Headless self-check of YouTube channel mapping (no network).
// Run: node --experimental-strip-types lib/server/people/sources/youtube.selfcheck.mjs
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

const { mapYoutubeChannel, countryAliases, matchesCountry } =await import("./youtube.ts");
const plan = { role: "Entrenador personal", location: "Córdoba, Argentina" };

// 1. Canal completo: email + phones[] + WhatsApp + redes + web
const full = mapYoutubeChannel({
  channelName: "Fede Entrena",
  channelHandle: "@fedeentrena",
  channelId: "UC123",
  channelUrl: "https://www.youtube.com/@fedeentrena",
  email: "Fede.Entrena@Gmail.com",
  emails: ["fede.entrena@gmail.com"],
  phone: "",
  phones: [{ phone: "+54 9 351 555-1234", raw: "351 555 1234", source: "description", sourceUrl: "https://www.youtube.com/@fedeentrena/about" }],
  whatsappUrl: "https://wa.me/5493515551234",
  instagramUrl: "https://www.instagram.com/fedeentrena",
  facebookUrl: "https://www.facebook.com/sharer/sharer.php?u=x",
  linkedinUrl: "https://www.linkedin.com/in/fede-entrena",
  websiteUrl: "https://fedeentrena.com.ar",
  subscriberCountText: "12,3 k suscriptores",
  subscriberCount: 12300,
  country: "Argentina",
  description: "Rutinas de fuerza y funcional en Córdoba. ".repeat(20),
}, plan);
assert.equal(full.source, "youtube");
assert.equal(full.sourceUrl, "https://www.youtube.com/@fedeentrena");
assert.equal(full.email, "fede.entrena@gmail.com");
assert.equal(full.phone, "+5493515551234");
assert.equal(full.whatsapp, "+5493515551234");
assert.equal(full.website, "https://fedeentrena.com.ar");
assert.equal(full.location, "Argentina");
assert.equal(full.role, "Entrenador personal");
assert.deepEqual(full.socialProfiles, {
  youtube: "https://www.youtube.com/@fedeentrena",
  instagram: "https://www.instagram.com/fedeentrena",
  linkedin: "https://www.linkedin.com/in/fede-entrena",
}, "sharer de Facebook descartado");
assert.ok(full.snippet.endsWith("12,3 k suscriptores"));
assert.ok(full.snippet.length <= 300 + 3 + 20);
assert.equal(full.isBusiness, false);

// 2. Solo teléfono en phones[]; sin country → plan.location; web social no cuenta como sitio
const phoneOnly = mapYoutubeChannel({
  channelName: "Gimnasio Grupo Norte",
  channelUrl: "https://www.youtube.com/channel/UC999",
  email: "",
  phones: [{ phone: "123", raw: "123" }, { phone: "+54 351 444 5566", raw: "0351 444 5566" }],
  websiteUrl: "https://www.instagram.com/gimnasionorte",
  subscriberCount: 850,
}, plan);
assert.equal(phoneOnly.phone, "+543514445566");
assert.equal(phoneOnly.email, "");
assert.equal(phoneOnly.website, "");
assert.equal(phoneOnly.location, "Córdoba, Argentina");
assert.equal(phoneOnly.isBusiness, true, "\"Grupo\" es negocio");
assert.ok(phoneOnly.snippet.includes("850 subscribers"));

// 3. Sin contacto (email inválido) → null; sin nombre/URL → null
assert.equal(mapYoutubeChannel({ channelName: "Sin datos", channelUrl: "https://www.youtube.com/@sindatos", email: "logo@2x.png", phones: [] }, plan), null);
assert.equal(mapYoutubeChannel({ channelName: "Nada", channelUrl: "https://www.youtube.com/@nada" }, plan), null);
assert.equal(mapYoutubeChannel({ email: "a@b.com" }, plan), null);

// 4. Handle sin channelUrl
const handle = mapYoutubeChannel({ channelName: "Ana Fit", channelHandle: "anafit", emails: ["ana@fit.com.ar"] }, plan);
assert.equal(handle.sourceUrl, "https://www.youtube.com/@anafit");
assert.equal(handle.email, "ana@fit.com.ar");

// 5. Filtro de país: AR acepta "Argentina"/"AR"/sin país, rechaza "Spain"/"España"
const ar = countryAliases("AR");
assert.equal(matchesCountry({ country: "Argentina" }, ar), true);
assert.equal(matchesCountry({ country: "AR" }, ar), true);
assert.equal(matchesCountry({}, ar), true);
assert.equal(matchesCountry({ country: "Spain" }, ar), false);
assert.equal(matchesCountry({ country: "España" }, ar), false);
assert.equal(matchesCountry({ country: "Mexico" }, countryAliases("MX")), true, "sin tilde vs México");

console.log("youtube selfcheck OK");
