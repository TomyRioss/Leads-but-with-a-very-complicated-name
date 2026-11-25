import assert from "node:assert/strict";
import { businessDomain, enrichmentCacheKey, painCacheKey, placeKeyFromMapsUrl, selectPainReviews } from "./lead-analysis-input.ts";

// 1. Reviews: low ratings first (stable), at most 20, text 800 and reply 300 chars.
const review = (i, rating) => ({ text: `r${i} ` + "x".repeat(2000), rating, published_at: "", owner_response: "y".repeat(1000) });
const reviews = [...Array.from({ length: 30 }, (_, i) => review(i, 5)), review(100, 2), review(101, null), review(102, 3), review(103, 1)];
const picked = selectPainReviews(reviews);
assert.equal(picked.length, 20);
assert.deepEqual(picked.slice(0, 3).map((r) => r.text.split(" ")[0]), ["r100", "r102", "r103"]);
assert.equal(picked[3].text.split(" ")[0], "r0");
assert.ok(picked.every((r) => r.text.length <= 800 && r.owner_response.length <= 300));
assert.equal(picked[0].text.length, 800);
assert.equal(reviews[30].text.length, 2005, "input is not mutated");
assert.equal(selectPainReviews([review(1, 4)])[0].owner_response.length, 300);

// 2. Place identity.
assert.equal(placeKeyFromMapsUrl("https://www.google.com/maps/search/?api=1&query=Cafe&query_place_id=ChIJN1t_tDeuEmsRUsoyG83frY4"), "pid:ChIJN1t_tDeuEmsRUsoyG83frY4");
assert.equal(placeKeyFromMapsUrl("https://maps.google.com/?cid=1234567890123"), "cid:1234567890123");
assert.equal(placeKeyFromMapsUrl("https://www.google.com/maps/place/Cafe/data=!4m2!3m1!1s0x95bccb:0xABC123"), "fid:0x95bccb:0xabc123");
assert.equal(placeKeyFromMapsUrl(""), "");
assert.equal(placeKeyFromMapsUrl("not a url"), "");

// 3. Domains: shared hosts never identify a business.
assert.equal(businessDomain("https://www.Cafe-Luna.com.ar/contacto"), "cafe-luna.com.ar");
assert.equal(businessDomain("https://instagram.com/cafeluna"), "");
assert.equal(businessDomain("https://linktr.ee/cafeluna"), "");
assert.equal(businessDomain("ftp://cafe.com"), "");

// 4. Enrichment key: place first, else domain; networks and missing fields sorted and deduped.
const maps = "https://www.google.com/maps/search/?api=1&query_place_id=ChIJabcdefghijk";
const a = enrichmentCacheKey({ mapsUrl: maps, website: "https://cafe.com", networks: ["instagram", "facebook"], missing: ["phone", "email", "instagram"] });
const b = enrichmentCacheKey({ mapsUrl: maps, website: "", networks: ["facebook", "instagram", "facebook"], missing: ["instagram", "email", "phone"] });
assert.equal(a, "pid:ChIJabcdefghijk|n=facebook,instagram|m=email,instagram,phone");
assert.equal(a, b);
assert.notEqual(a, enrichmentCacheKey({ mapsUrl: maps, website: "", networks: ["facebook", "instagram"], missing: ["instagram"] }));
assert.equal(enrichmentCacheKey({ mapsUrl: "", website: "https://www.cafe.com/", networks: ["linkedin"], missing: [] }), "dom:cafe.com|n=linkedin|m=");
assert.equal(enrichmentCacheKey({ mapsUrl: "", website: "https://facebook.com/cafe", networks: ["linkedin"], missing: [] }), "");

// 5. Pain key: never with a focus; locale is part of the key.
assert.equal(painCacheKey({ mapsUrl: maps, focus: "", locale: "es" }), "pid:ChIJabcdefghijk|l=es");
assert.notEqual(painCacheKey({ mapsUrl: maps, focus: "", locale: "en" }), painCacheKey({ mapsUrl: maps, focus: "", locale: "es" }));
assert.equal(painCacheKey({ mapsUrl: maps, focus: "diseño web", locale: "es" }), "");
assert.equal(painCacheKey({ mapsUrl: "", focus: "", locale: "es" }), "");

console.log("lead-analysis-input selfcheck ok");
