// Headless self-check of source routing and country filter (no network).
// Run: node --experimental-strip-types lib/server/people/router.selfcheck.mjs
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
registerHooks({
  resolve(specifier, context, next) {
    const base = specifier.startsWith("@/") ? pathToFileURL(root + specifier.slice(2)).href
      : specifier.startsWith(".") && context.parentURL ? new URL(specifier, context.parentURL).href : null;
    if (base && !/\.[cm]?[jt]s$/.test(base) && existsSync(fileURLToPath(base + ".ts"))) return next(base + ".ts", context);
    return next(specifier, context);
  },
});

const { defaultSources, sanitizeSources, routeSources } = await import("./router.ts");
const { candidateCountry, fitsCountry } = await import("./enrich.ts");
const { parsePlan } = await import("./planner.ts");
const { classifyCandidate } = await import("./classify.ts");

const base = { profileType: "freelance", intent: "", role: "", location: "Córdoba, Argentina", githubQuery: null, facebookGroupQueries: [] };

// 1. Tabla fija
assert.deepEqual(defaultSources({ ...base, intent: "fitness influencers who post on Instagram/TikTok" }), ["instagram", "tiktok", "youtube", "serper"]);
assert.deepEqual(defaultSources({ ...base, profileType: "technical", intent: "freelance React developers", role: "Dev React" }), ["serper", "github", "fiverr"]);
assert.deepEqual(defaultSources({ ...base, profileType: "trade", intent: "local electricians", role: "electricista" }), ["serper", "facebook", "instagram"]);
assert.deepEqual(defaultSources({ ...base, intent: "graphic designers for logos" }), ["behance", "instagram", "fiverr", "serper"]);
assert.ok(!defaultSources({ ...base, intent: "people who are here, aquí" }).includes("behance"), "'aquí' no es UI");

// 2. Saneo de lo que devuelve Jev
assert.deepEqual(sanitizeSources(["instagram", "tiktok", "hacker", "instagram"], base), ["serper", "instagram", "tiktok"], "ids desconocidos y repetidos fuera, Google siempre");
assert.deepEqual(sanitizeSources(["github", "facebook"], base), ["serper"], "sin githubQuery / grupos");
assert.deepEqual(sanitizeSources(["github"], { ...base, githubQuery: "language:ts" }), ["serper", "github"]);
assert.equal(sanitizeSources(["instagram", "tiktok", "youtube", "fiverr", "behance", "facebook"], { ...base, facebookGroupQueries: ["x"] }).length, 5, "máx 5");
assert.deepEqual(sanitizeSources("nope", base), ["serper"]);

// 3. Sin API key → fallback, nunca lanza
const key = process.env.OPENROUTER_API_KEY;
delete process.env.OPENROUTER_API_KEY;
const routed = await routeSources({ ...base, intent: "fitness influencers", keywords: [], webQueries: [], instagramQueries: [], summary: "", sources: [] });
assert.equal(routed.routedBy, "fallback");
assert.deepEqual(routed.sources, ["serper", "instagram", "tiktok", "youtube"]);
if (key) process.env.OPENROUTER_API_KEY = key;

// 4. País del candidato
assert.equal(candidateCountry({ phone: "+543512221211", whatsapp: "", location: "" }), "ar");
assert.equal(candidateCountry({ phone: "", whatsapp: "+59899123456", location: "" }), "uy", "+598 antes que +5x");
assert.equal(candidateCountry({ phone: "+34664769298", whatsapp: "", location: "Córdoba, Spain" }), "es");
assert.equal(candidateCountry({ phone: "3512221211", whatsapp: "", location: "Córdoba" }), "", "local sin país");
assert.equal(candidateCountry({ phone: "", whatsapp: "", location: "Bogotá, Colombia" }), "co");
assert.equal(fitsCountry({ phone: "+34664769298", whatsapp: "", location: "" }, "ar"), false);
assert.equal(fitsCountry({ phone: "", whatsapp: "", location: "" }, "ar"), true, "desconocido se queda");
assert.equal(fitsCountry({ phone: "+34664769298", whatsapp: "", location: "" }, ""), true, "sin ubicación pedida");

// 5. Plan con intent/keywords
const plan = parsePlan('{"sensitive":false,"suggestion":"","profile_type":"freelance","role":"influencer fitness","location":"Córdoba, Argentina","summary":"Influencers","intent":"fitness influencers on Instagram","keywords":["fitness","entrenador personal","fitness","x".repeat(1)],"web_queries":["a","b","c"],"github_query":"","instagram_queries":[],"facebook_group_queries":[]}'.replace('"x".repeat(1)', '"x"'), { query: "influencers fitness", location: "Córdoba" });
assert.equal(plan.intent, "fitness influencers on Instagram");
assert.deepEqual(plan.keywords, ["fitness", "entrenador personal", "x"]);
assert.deepEqual(plan.sources, []);
const noIntent = parsePlan('{"sensitive":false,"profile_type":"trade","role":"r","location":"","summary":"Electricistas","web_queries":["a","b","c"]}', { query: "electricista", location: "" });
assert.equal(noIntent.intent, "Electricistas", "fallback a summary");
assert.deepEqual(noIntent.keywords, []);

// 6. Plataformas: nombre de persona pasa, handles/medios van al modelo, empresas fuera
const ig = (name, extra = {}) => ({ name, role: "", location: "", phone: "+5491100000000", whatsapp: "", email: "", website: "", socialProfiles: {}, source: "instagram", sourceUrl: "https://www.instagram.com/x", snippet: "", ...extra });
assert.equal(classifyCandidate(ig("Leandro Gómez")).verdict, "person");
assert.equal(classifyCandidate(ig("Zona Norte Diario Online")).verdict, "unsure");
assert.equal(classifyCandidate(ig("WOW City | Juegos infantiles")).verdict, "unsure");
assert.equal(classifyCandidate(ig("Electro Soluciones SRL")).verdict, "reject");
assert.equal(classifyCandidate(ig("Ana Paz", { source: "tiktok", isBusiness: true })).verdict, "reject");
assert.equal(classifyCandidate(ig("dev1", { source: "github" })).verdict, "person", "github sigue directo");

console.log("people router self-check OK");
