// Headless self-check: node --experimental-strip-types lib/server/people/planner.selfcheck.mjs
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

// Resuelve el alias "@/..." y los imports sin extensión hacia los .ts del repo (solo para este script).
const root = fileURLToPath(new URL("../../../", import.meta.url));
registerHooks({
  resolve(specifier, context, next) {
    const base = specifier.startsWith("@/") ? pathToFileURL(root + specifier.slice(2)).href
      : specifier.startsWith(".") && context.parentURL ? new URL(specifier, context.parentURL).href : null;
    if (base && !/\.[cm]?[jt]s$/.test(base) && existsSync(fileURLToPath(base + ".ts"))) return next(base + ".ts", context);
    return next(specifier, context);
  },
});

const { parsePlan, checkSensitive, SensitiveSegmentError, extractJsonObject, messageText } = await import("./planner.ts");
const { candidateFromResult, serperLocale, mapLimit } = await import("./sources/serper.ts");
const { candidateFromGithubUser } = await import("./sources/github.ts");

// 1. Plan válido
const plan = parsePlan('Plan:\n{"sensitive":false,"suggestion":"","profile_type":"trade","role":"Electricista matriculado","location":"Zona Norte, Buenos Aires","summary":"Electricistas independientes","web_queries":["\\"electricista matriculado\\" \\"zona norte\\" whatsapp","\\"electricista\\" \\"San Isidro\\" particular -empresa -srl","electricista matriculado vicente lopez whatsapp","electricista matriculado vicente lopez whatsapp"],"github_query":"language:go","instagram_queries":["electricistazonanorte","#electricista"],"facebook_group_queries":["vecinos zona norte"]}', { query: "electricista", location: "zona norte" });
assert.equal(plan.profileType, "trade");
assert.equal(plan.webQueries.length, 3, "dedupe de queries");
assert.equal(plan.githubQuery, null, "github solo para técnicos");
assert.deepEqual(plan.facebookGroupQueries, ["vecinos zona norte"]);
const tech = parsePlan('{"sensitive":false,"suggestion":"","profile_type":"technical","role":"Dev React","location":"","summary":"","web_queries":["a","b","c"],"github_query":"language:typescript location:argentina","instagram_queries":[],"facebook_group_queries":[]}', { query: "dev react freelance", location: "Argentina" });
assert.equal(tech.githubQuery, "language:typescript location:argentina");
assert.equal(tech.location, "Argentina", "fallback de ubicación");
assert.throws(() => parsePlan('{"profile_type":"trade","web_queries":["a"]}', { query: "x", location: "" }), /fewer than 3/);
assert.throws(() => parsePlan("sin json", { query: "x", location: "" }), /no JSON/);
assert.throws(() => parsePlan('{"sensitive":true,"suggestion":"Negocios para ese público"}', { query: "x", location: "" }), (error) => error instanceof SensitiveSegmentError && error.suggestion === "Negocios para ese público");

// 1b. Respuestas sucias del modelo
const body = '{"sensitive":false,"suggestion":"","profile_type":"trade","role":"Limpieza","location":"Palermo","summary":"s {con llaves} \\"citas\\"","web_queries":["a","b","c"],"github_query":"","instagram_queries":[],"facebook_group_queries":[]}';
assert.equal(parsePlan("```json\n" + body + "\n```", { query: "x", location: "" }).role, "Limpieza", "bloque ```json");
assert.equal(parsePlan("Claro, acá va el plan {borrador} y luego:\n" + body + "\nEspero que sirva.", { query: "x", location: "" }).summary, 's {con llaves} "citas"', "texto alrededor");
assert.throws(() => parsePlan("", { query: "x", location: "" }), /no JSON/, "content vacío");
assert.equal(messageText({ content: "", reasoning: body }), body, "fallback a reasoning");
assert.equal(messageText({ content: [{ type: "text", text: body }] }), body, "content en partes");
assert.equal(extractJsonObject("[1,2]"), null);

// 2. Filtro sensible
assert.ok(checkSensitive("jubilados en Palermo", "es"));
assert.ok(checkSensitive("personas católicas en Córdoba", "es"));
assert.ok(checkSensitive("pacientes con diabetes", "es"));
assert.ok(checkSensitive("divorced men in Miami", "en"));
for (const ok of ["personal de limpieza en Palermo", "vendedores de seguros en Córdoba", "dev React freelance", "contador independiente en Rosario", "electricista matriculado zona norte"]) assert.equal(checkSensitive(ok, "es"), null, ok);

// 3. Extracción de snippets
const a = candidateFromResult({ title: "Juan Pérez - Electricista matriculado | Zona Norte", link: "https://wa.me/5491122334455", snippet: "Trabajos a domicilio. Escribime juan.perez@gmail.com o al 11 2233-4455." }, "Zona Norte");
assert.equal(a.name, "Juan Pérez");
assert.equal(a.role, "Electricista matriculado");
assert.equal(a.email, "juan.perez@gmail.com");
assert.equal(a.whatsapp, "+5491122334455");
assert.equal(a.phone, "1122334455");
assert.equal(a.isBusiness, false);
const b = candidateFromResult({ title: "Limpiezas Integrales SRL - Empresa de limpieza", link: "https://limpiezas.com.ar", snippet: "Tel +54 11 4555-6677" }, "Palermo");
assert.equal(b.isBusiness, true);
assert.equal(b.phone, "+541145556677");
assert.equal(b.website, "https://limpiezas.com.ar");
const c = candidateFromResult({ title: "María Gómez - Asesora de seguros - LinkedIn", link: "https://ar.linkedin.com/in/mariagomez", snippet: "Córdoba, Argentina · 2024-05-10 · logo@2x.png" }, "Córdoba");
assert.equal(c.socialProfiles.linkedin, "https://ar.linkedin.com/in/mariagomez");
assert.equal(c.website, "");
assert.equal(c.email, "");
assert.equal(c.phone, "", "fecha no es teléfono");
assert.equal(candidateFromResult({ title: "Contador", link: "https://www.paginasamarillas.com.ar/x" }, "Rosario").isBusiness, true);
assert.equal(candidateFromResult({ title: "", link: "https://x.com" }, ""), null);

// 4. GitHub, locale y concurrencia
const g = candidateFromGithubUser({ login: "dev1", html_url: "https://github.com/dev1", name: null, bio: "React freelance", email: "dev1@example.com", blog: "dev1.dev", type: "User" }, "Dev React");
assert.equal(g.name, "dev1"); assert.equal(g.email, "", "example.* descartado"); assert.equal(g.website, "https://dev1.dev");
assert.deepEqual(serperLocale("Palermo"), { gl: "ar", hl: "es" });
assert.deepEqual(serperLocale("Madrid, España"), { gl: "es", hl: "es" });
let active = 0; let peak = 0;
const out = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => { active++; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 5)); active--; return n * 2; });
assert.deepEqual(out, [2, 4, 6, 8, 10, 12, 14]); assert.ok(peak <= 3);

// 5. Clasificación persona vs artículo/empresa/directorio (títulos reales de una búsqueda "vendedor")
const { classifyCandidate, looksLikePersonName, parseModelVerdicts } = await import("./classify.ts");
const { withExclusions, extraQueries } = await import("./planner.ts");
const cand = (name, sourceUrl, extra = {}) => ({ name, role: "", location: "Argentina", phone: "", whatsapp: "", email: "", website: "", socialProfiles: {}, source: "serper", sourceUrl, snippet: "", ...extra });
const rejected = [
  cand("Dónde publicar tu auto en Argentina: comparativa 2026", "https://autos.example.com.ar/publicar-auto"),
  cand("La digitalización transformó la compra de usados", "https://revista.example.com/usados"),
  cand("Puntos de venta en Argentina", "https://marca.example.com/puntos"),
  cand("Registro para Vendedores", "https://plataforma.example.com/vendedores", { email: "support@plataforma.example.com" }),
  cand("Facebook en San Miguel de Tucumán", "https://www.facebook.com/groups/123"),
  cand("Autiffy", "https://autiffy.example.com/", { role: "CRM de WhatsApp para concesionarias", email: "hola@autiffy.example.com" }),
  cand("Ventas Express", "https://ventas.example.com", { email: "info@ventas.example.com" }),
  cand("Juan Pérez", "https://www.infobae.com/nota/juan-perez"),
  cand("María Gómez", "https://blog.example.com/blog/maria-gomez"),
];
for (const c of rejected) assert.equal(classifyCandidate(c).verdict, "reject", c.name);
const accepted = [
  cand("Juan Pérez", "https://ar.linkedin.com/in/juanperez", { role: "Vendedor - Asesor comercial" }),
  cand("María Laura González", "https://marialaura.example.com.ar", { role: "Productora asesora de seguros", phone: "+5491122334455" }),
  cand("Carlos Rodríguez", "https://cr.example.com", { snippet: "Soy electricista matriculado en zona norte, escribime." }),
  cand("Ana de los Santos", "https://www.instagram.com/anadelossantos", {}),
  { ...cand("dev1", "https://github.com/dev1"), source: "github" },
];
for (const c of accepted) assert.equal(classifyCandidate(c).verdict, "person", c.name);
assert.equal(classifyCandidate(cand("Hola. Me llamo Carolina.", "https://www.facebook.com/groups/123/posts/456")).verdict, "unsure", "post personal → modelo");
assert.equal(classifyCandidate(cand("Buenas tardes ofrezco servicios de limpieza a domicilio", "https://www.facebook.com/groups/1/posts/2")).verdict, "unsure");
assert.equal(classifyCandidate(cand("Limpiezas Integrales SRL", "https://www.facebook.com/groups/1/posts/3")).verdict, "reject");
assert.equal(classifyCandidate(cand("Servicio de limpieza Palermo", "https://limpia.example.com")).verdict, "unsure");
assert.equal(classifyCandidate(cand("Lucía Fernández", "https://lucia.example.com", { email: "info@lucia.example.com" })).verdict, "unsure", "email genérico con nombre → modelo");
assert.ok(looksLikePersonName("María de los Ángeles Gómez")); assert.ok(!looksLikePersonName("Puntos de venta en Argentina")); assert.ok(!looksLikePersonName("Gómez SRL"));
const verdicts = parseModelVerdicts('```json\n{"items":[{"i":0,"person":true,"name":"Laura Díaz","role":"Limpieza"},{"i":1,"person":false,"name":"","role":""},{"i":9,"person":true,"name":"X Y","role":""},{"i":2,"person":true,"name":"Limpiezas SRL","role":""}]}\n```', 3);
assert.deepEqual([...verdicts.keys()], [0]); assert.equal(verdicts.get(0).name, "Laura Díaz");
assert.equal(parseModelVerdicts("", 3).size, 0);

// 6. Exclusiones y ronda extra
const ex = withExclusions('"soy vendedor" Córdoba whatsapp -blog');
assert.ok(ex.includes("-noticias") && ex.includes("-site:mercadolibre.com.ar") && ex.split("-blog").length === 2, ex);
assert.equal(withExclusions("site:linkedin.com/in vendedor"), "site:linkedin.com/in vendedor");
assert.ok(withExclusions("a ".repeat(40).trim()).split(/\s+/).length <= 40);
const extras = extraQueries({ role: "vendedor", location: "Córdoba, Argentina", webQueries: [] }, []);
assert.equal(extras.length, 3); assert.ok(extras[0].startsWith('"soy vendedor" "Córdoba"'));
assert.equal(extraQueries({ role: "vendedor", location: "", webQueries: [] }, [withExclusions('"soy vendedor" whatsapp')]).length, 2, "no repite queries usadas");
assert.ok(extraQueries({ role: "React developer", location: "", webQueries: [] }, [])[0].startsWith(`"I'm a React developer"`));

console.log("people planner self-check OK");
