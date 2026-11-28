import assert from "node:assert/strict";
import { leadsCacheKey } from "./dedupe.ts";

// Same keywords in another order, case or spacing → same key: a second visitor reuses the cached Apify result.
const base = leadsCacheKey("Argentina", ["Restaurantes", "parrillas"], "es");
assert.equal(base, leadsCacheKey("argentina ", ["PARRILLAS", "  restaurantes"], "es"));

// Another country, keyword set or locale → another key.
assert.notEqual(base, leadsCacheKey("Uruguay", ["restaurantes", "parrillas"], "es"));
assert.notEqual(base, leadsCacheKey("Argentina", ["restaurantes", "cafeterías"], "es"));
assert.notEqual(base, leadsCacheKey("Argentina", ["restaurantes"], "es"));
assert.notEqual(base, leadsCacheKey("Argentina", ["restaurantes", "parrillas"], "en"));
// Words do not move between keywords: ["a b", "c"] is not ["a", "b c"].
assert.notEqual(leadsCacheKey("Argentina", ["pan casero", "café"], "es"), leadsCacheKey("Argentina", ["pan", "casero café"], "es"));

// Keywords and country are hashed, never in the key as text.
assert.ok(!base.includes("restaurantes") && !base.toLowerCase().includes("argentina"));
assert.ok(base.endsWith(":es"));

console.log("leads-cache selfcheck ok");
