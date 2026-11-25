// node lib/utm.selfcheck.mjs
import assert from "node:assert/strict";
import { buildUtmUrl, slugUtm, UTM_PRESETS } from "./utm.ts";

assert.equal(slugUtm("Black Friday 2026!"), "black-friday-2026");
assert.equal(slugUtm("  Campaña   Navidad  "), "campana-navidad");
assert.equal(slugUtm("---"), "");
assert.equal(slugUtm("a".repeat(150)).length, 100);

const base = { source: "instagram", medium: "social", campaign: "Lanzamiento Leadta", content: "", term: "" };
assert.equal(buildUtmUrl("https://leadta.app/", base), "https://leadta.app/?utm_source=instagram&utm_medium=social&utm_campaign=lanzamiento-leadta");
// Conserva parámetros existentes, reemplaza utm_* viejos y agrega content/term.
assert.equal(
  buildUtmUrl("https://leadta.app/pricing?ref=abc&utm_source=old", { ...base, content: "Reel 1", term: "leads" }),
  "https://leadta.app/pricing?ref=abc&utm_source=instagram&utm_medium=social&utm_campaign=lanzamiento-leadta&utm_content=reel-1&utm_term=leads",
);
// Inválidos: URL rota, otro protocolo, faltan obligatorios.
assert.equal(buildUtmUrl("leadta", base), null);
assert.equal(buildUtmUrl("javascript:alert(1)", base), null);
assert.equal(buildUtmUrl("https://leadta.app/", { ...base, campaign: "  " }), null);
assert.equal(new Set(UTM_PRESETS.map((preset) => preset.id)).size, UTM_PRESETS.length);

console.log("utm selfcheck OK");
