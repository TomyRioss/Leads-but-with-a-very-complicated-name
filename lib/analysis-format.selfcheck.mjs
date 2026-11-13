import assert from "node:assert/strict";
import { normalizePainOutput, parsePainContent, normalizeTags, painView, resolveFindings, hasPainResult } from "./analysis-format.ts";

// 1. Formato nuevo
const fresh = parsePainContent('Aquí va:\n```json\n{"tags":["Demora en atención","demora en atención","Precios poco claros","a","b","c"],"report":"  Varias reseñas   citan demoras (R1, R2). ","findings":[{"title":"Demora","detail":"Esperas largas","source_ids":["R1","X9"]}],"limitations":""}\n```');
assert.deepEqual(fresh.tags, ["Demora en atención", "Precios poco claros", "a", "b"]);
assert.equal(fresh.report, "Varias reseñas citan demoras (R1, R2).");
const sources = new Map([["R1", { id: "R1", label: "Reseña", text: "x".repeat(500), url: "" }]]);
const resolved = resolveFindings(fresh.findings, sources);
assert.equal(resolved.length, 1); assert.equal(resolved[0].sources.length, 1); assert.equal(resolved[0].sources[0].text.length, 360);
assert.equal(resolveFindings([{ title: "t", detail: "d", source_ids: ["Z"] }], sources).length, 0);

// 2. Formato viejo del modelo (summary + findings) → degrada
const old = parsePainContent('{"summary":"Resumen viejo","findings":[{"title":"Mala atención","detail":"d","source_ids":["R1"]}],"limitations":"l","social_profiles":[]}');
assert.deepEqual(old.tags, ["Mala atención"]); assert.equal(old.report, "Resumen viejo");

// 3. Basura / inválido
assert.equal(parsePainContent("no es json"), null);
assert.equal(parsePainContent("[1,2]"), null);
assert.equal(normalizePainOutput(null), null);
const empty = parsePainContent('{"tags":[],"report":"","findings":[],"limitations":"sin evidencia"}');
assert.equal(hasPainResult({ tags: empty.tags, report: empty.report, findings: [] }), false);

// 4. Tags de texto y largo máximo
assert.deepEqual(normalizeTags("uno; dos;\n tres"), ["uno", "dos", "tres"]);
assert.ok(normalizeTags(["x".repeat(200)])[0].length <= 48);

// 5. Compatibilidad lead viejo
const legacyDetail = { summary: "Resumen", findings: [{ title: "Esperas largas", detail: "Detalle", sources: [] }], limitations: "", status: "completed" };
let v = painView(legacyDetail, "Esperas largas");
assert.deepEqual(v.tags, ["Esperas largas"]); assert.equal(v.report, "Resumen"); assert.ok(v.hasContent);
v = painView(null, "Texto plano antiguo; otro");
assert.deepEqual(v.tags, ["Texto plano antiguo"]); assert.equal(v.report, "Texto plano antiguo; otro");
v = painView({ summary: "", findings: [], limitations: "", status: "completed", tags: ["A", "B"], report: "Rep" }, "A; B");
assert.deepEqual(v.tags, ["A", "B"]); assert.equal(v.report, "Rep");
v = painView({ summary: "", findings: [], limitations: "", status: "completed" }, "");
assert.equal(v.hasContent, false);
console.log("analysis-format self-check OK");
