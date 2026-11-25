import assert from "node:assert/strict";
import { competitorsCacheKey, hasLiveLease, LEASE_STALE_MS, normalizeText, researchCacheKey } from "./dedupe.ts";

// 1. Text normalization: case, spacing and Unicode forms collapse.
assert.equal(normalizeText("  Hola   MUNDO\n "), "hola mundo");
assert.equal(normalizeText("Ｃafé"), normalizeText("café")); // NFKC: full-width letter

// 2. Research: web keyed by domain + locale; text/services by hash of normalized text + locale.
const web = { mode: "web", url: "https://www.loruppa.com/" };
assert.equal(researchCacheKey(web, "loruppa.com", "es"), "web:loruppa.com:es");
assert.equal(researchCacheKey({ mode: "web", url: "https://loruppa.com/precios" }, "LORUPPA.com", "es"), "web:loruppa.com:es");
assert.notEqual(researchCacheKey(web, "loruppa.com", "es"), researchCacheKey(web, "loruppa.com", "en"));
const text = (description) => ({ mode: "text", description });
assert.equal(researchCacheKey(text("Vendo  pan casero"), "", "es"), researchCacheKey(text(" vendo pan CASERO "), "", "es"));
assert.notEqual(researchCacheKey(text("Vendo pan casero"), "", "es"), researchCacheKey(text("Vendo pan integral"), "", "es"));
assert.ok(researchCacheKey(text("Vendo pan casero"), "", "es").startsWith("text:"));
assert.ok(!researchCacheKey(text("Vendo pan casero"), "", "es").includes("pan")); // visitor text never in the key
const services = (offer, idealCustomer, markets) => ({ mode: "services", offer, idealCustomer, markets });
assert.equal(researchCacheKey(services("Diseño", "Pymes", "AR"), "", "es"), researchCacheKey(services("diseño", " pymes", "ar "), "", "es"));
assert.notEqual(researchCacheKey(services("Diseño", "Pymes", "AR"), "", "es"), researchCacheKey(services("Diseño Pymes", "", "AR"), "", "es"));
assert.ok(researchCacheKey(services("a", "b", "c"), "", "es").startsWith("services:"));

// 3. Competitors: domain (or name+summary hash) + market + locale.
const product = { name: "Loruppa", domain: "loruppa.com", summary: "Páginas para negocios", location: "Argentina", country: "Argentina" };
assert.equal(competitorsCacheKey(product, "es"), competitorsCacheKey({ ...product, name: "Otro nombre", summary: "otro" }, "es"));
assert.notEqual(competitorsCacheKey(product, "es"), competitorsCacheKey({ ...product, location: "Spain", country: "Spain" }, "es"));
assert.notEqual(competitorsCacheKey(product, "es"), competitorsCacheKey(product, "en"));
assert.equal(competitorsCacheKey(product, "es"), competitorsCacheKey({ ...product, location: " argentina " }, "es"));
const noDomain = { ...product, domain: "" };
assert.equal(competitorsCacheKey(noDomain, "es"), competitorsCacheKey({ ...noDomain, name: "LORUPPA", summary: "páginas  para negocios" }, "es"));
assert.notEqual(competitorsCacheKey(noDomain, "es"), competitorsCacheKey({ ...noDomain, summary: "Tiendas online" }, "es"));
assert.ok(competitorsCacheKey(noDomain, "es").startsWith("h:"));
assert.ok(competitorsCacheKey({ ...product, location: "", country: "" }, "es").includes(":-:"));

// 4. Lease: only the same step, only while fresh; missing fields (migration not applied) → no lease.
const now = Date.parse("2026-11-25T12:00:00.000Z");
const at = (msAgo) => new Date(now - msAgo).toISOString();
assert.equal(hasLiveLease({ running_step: "research", running_since: at(10_000) }, "research", now), true);
assert.equal(hasLiveLease({ running_step: "research", running_since: at(10_000) }, "competitors", now), false);
assert.equal(hasLiveLease({ running_step: "research", running_since: at(LEASE_STALE_MS + 1) }, "research", now), false);
assert.equal(hasLiveLease({ running_step: "research", running_since: at(LEASE_STALE_MS - 1) }, "research", now), true);
assert.equal(hasLiveLease({}, "research", now), false);
assert.equal(hasLiveLease({ running_step: "", running_since: "" }, "research", now), false);
assert.equal(hasLiveLease({ running_step: "research", running_since: "garbage" }, "research", now), false);
// PocketBase date format (space instead of "T").
assert.equal(hasLiveLease({ running_step: "leads", running_since: at(60_000).replace("T", " ") }, "leads", now), true);
assert.equal(LEASE_STALE_MS, 4 * 60_000);

console.log("dedupe selfcheck ok");
