// Self-check headless: node --experimental-strip-types lib/search-random-location.selfcheck.mjs
import assert from "node:assert/strict";
import { planRandomSearch, splitEvenly, remainingCallTimeoutMs, RANDOM_LOCATION_COUNTRIES } from "./search-random-location.ts";

for (const count of [1, 7, 25, 150]) {
  for (const k of [1, 2, 3]) {
    const keywords = ["a", "b", "c"].slice(0, k);
    for (const offset of [0, 3, 9]) {
      const plan = planRandomSearch(count, keywords, offset);
      assert.equal(plan.reduce((sum, slot) => sum + slot.limit, 0), count, `suma ${count}/${k}`);
      assert.ok(plan.every((slot) => slot.limit > 0));
      const byCountry = RANDOM_LOCATION_COUNTRIES.map((c) => plan.filter((s) => s.country === c).reduce((n, s) => n + s.limit, 0));
      assert.ok(Math.max(...byCountry) - Math.min(...byCountry) <= 1, `países parejos ${count}/${k}`);
      for (const c of RANDOM_LOCATION_COUNTRIES) {
        const per = keywords.map((kw) => plan.find((s) => s.country === c && s.keyword === kw)?.limit ?? 0);
        assert.ok(Math.max(...per) - Math.min(...per) <= 1, `keywords parejas ${c} ${count}/${k}`);
      }
    }
  }
}
assert.deepEqual(splitEvenly(7, 3), [3, 2, 2]);
assert.deepEqual(splitEvenly(0, 3), [0, 0, 0]);
// Timeouts restantes: tope habitual al inicio, se achica hacia el deadline (240 s - 20 s de margen) y corta con < 30 s.
assert.equal(remainingCallTimeoutMs(0), 220_000);
assert.equal(remainingCallTimeoutMs(100_000), 120_000);
assert.equal(remainingCallTimeoutMs(100_000, 60_000), 60_000);
assert.equal(remainingCallTimeoutMs(210_000), 10_000);
assert.equal(remainingCallTimeoutMs(210_001), 0);
assert.equal(remainingCallTimeoutMs(239_000), 0);
console.log("ok");
