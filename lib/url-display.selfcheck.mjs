// Run: node --experimental-strip-types lib/url-display.selfcheck.mjs
import assert from "node:assert/strict";
import { cleanWebsiteUrl, displayWebsite } from "./url-display.ts";

// Real provider URL.
assert.equal(cleanWebsiteUrl("mastersupply.com.ar/?utm_source=GoogleMaps&utm_medium=MyBusiness"), "https://mastersupply.com.ar");
assert.equal(displayWebsite("mastersupply.com.ar/?utm_source=GoogleMaps&utm_medium=MyBusiness"), "mastersupply.com.ar");
assert.equal(displayWebsite("https://www.mastersupply.com.ar/?utm_source=GoogleMaps&utm_medium=MyBusiness"), "mastersupply.com.ar");

// Other tracking params removed, real params kept.
assert.equal(cleanWebsiteUrl("http://shop.com/p?id=4&gclid=x&fbclid=y&srsltid=z&UTM_Campaign=a"), "http://shop.com/p?id=4");
assert.equal(cleanWebsiteUrl("https://a.com/?_gl=1*abc&msclkid=2"), "https://a.com");
assert.equal(cleanWebsiteUrl("https://a.com/menu#utm_source=GoogleMaps"), "https://a.com/menu");
assert.equal(cleanWebsiteUrl("https://a.com/menu#reservas"), "https://a.com/menu#reservas");

// Protocol normalization and invalid input.
assert.equal(cleanWebsiteUrl("  www.cafe.com  "), "https://www.cafe.com");
assert.equal(cleanWebsiteUrl("javascript:alert(1)"), "");
assert.equal(cleanWebsiteUrl("ftp://files.com"), "");
assert.equal(cleanWebsiteUrl("not a url"), "");
assert.equal(cleanWebsiteUrl(""), "");
assert.equal(cleanWebsiteUrl(null), "");

// Display: path kept short, query dropped, truncated.
assert.equal(displayWebsite("https://www.estudio.com/contacto/?utm_source=GoogleMaps"), "estudio.com/contacto");
assert.equal(displayWebsite("https://site.com/a?b=1"), "site.com/a");
const long = displayWebsite("https://example.com/" + "x".repeat(80));
assert.equal(long.length, 40);
assert.ok(long.endsWith("…"));

// Never leaks the provider name.
for (const value of ["https://x.com/?utm_source=GoogleMaps", "x.com?utm_medium=MyBusiness&utm_source=GoogleMaps"]) {
  assert.doesNotMatch(cleanWebsiteUrl(value) + displayWebsite(value), /google|mybusiness/i);
}

console.log("url-display selfcheck: ok");
