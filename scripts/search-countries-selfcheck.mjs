// Self-check del reparto multipaís: node --experimental-strip-types scripts/search-countries-selfcheck.mjs
import assert from "node:assert/strict";
import { countriesLabel, planRandomSearch } from "../lib/search-random-location.ts";

const countries = ["Argentina", "Chile", "Uruguay"];
const plan = planRandomSearch(10, ["inmobiliarias", "bienes raíces"], 0, countries);
assert.equal(plan.reduce((sum, slot) => sum + slot.limit, 0), 10, "la suma de límites es exactamente count");
const perCountry = countries.map((country) => plan.filter((slot) => slot.country === country).reduce((sum, slot) => sum + slot.limit, 0));
assert.ok(Math.max(...perCountry) - Math.min(...perCountry) <= 1, "reparto parejo entre países");
assert.ok(plan.every((slot) => countries.includes(slot.country)), "solo los países elegidos");

assert.equal(countriesLabel(countries), "Argentina, Chile, Uruguay");
const many = Array.from({ length: 10 }, (_, index) => `República Federal Número ${index}`);
const label = countriesLabel(many);
assert.ok(label.length <= 100 && /\+\d+$/.test(label), "etiqueta recortada con +N dentro de 100 caracteres");
console.log("search-countries selfcheck OK");
