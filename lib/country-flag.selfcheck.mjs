import assert from "node:assert/strict";
import { countryCode, flagUrl } from "./country-flag.ts";

assert.equal(countryCode("Colombia"), "CO");
assert.equal(countryCode("Estados Unidos"), "US");
assert.equal(countryCode("United States"), "US");
assert.equal(countryCode("méxico"), "MX");
assert.equal(countryCode("España"), "ES");
assert.equal(countryCode("ar"), "AR");
assert.equal(countryCode("Narnia"), "");
assert.equal(countryCode(""), "");
assert.equal(flagUrl("CO"), "https://flagcdn.com/w40/co.png");
console.log("country-flag selfcheck ok");
