// Self-check de reglas de campañas: node --experimental-strip-types scripts/campaigns-selfcheck.mjs
import assert from "node:assert/strict";
import { discountedCost, liveCampaigns } from "../lib/campaigns.ts";

assert.equal(discountedCost(10, 2, 50), 10, "50% de 10 leads x 2 = 10");
assert.equal(discountedCost(3, 4, 30), 9, "30% de 12 = 8.4 → 9 (redondeo hacia arriba en el total)");
assert.equal(discountedCost(5, 2, 0), 10, "sin descuento");
assert.equal(discountedCost(5, 2, 100), 0, "100% = gratis");

const now = Date.parse("2026-11-20T12:00:00Z");
const base = { label: "Oferta", message: "m", features: [], active: true, startsAt: "2026-11-15T00:00:00Z", endsAt: "2026-11-22T00:00:00Z" };
const live = liveCampaigns([
  { ...base, id: "a", name: "todo", discountPercent: 20, allFeatures: true, message: "20 todo" },
  { ...base, id: "b", name: "leads", discountPercent: 50, allFeatures: false, features: ["lead_search"], message: "50 leads" },
  { ...base, id: "c", name: "vencida", discountPercent: 90, allFeatures: true, endsAt: "2026-11-19T00:00:00Z" },
  { ...base, id: "d", name: "inactiva", discountPercent: 80, allFeatures: true, active: false },
], now);
assert.deepEqual(live.discounts, { lead_search: 50, people_search: 20, pain_analysis: 20 }, "mayor descuento vigente por funcionalidad");
assert.equal(live.banner?.message, "50 leads", "franja = campaña vigente más fuerte");
assert.equal(liveCampaigns([], now).banner, null);
console.log("campaigns selfcheck OK");
