// Self-check de los cálculos de Lead Suite insights: node --experimental-strip-types lib/server/lead-suite-insights.selfcheck.mjs
import assert from "node:assert/strict";
import { computeInsightMetrics, fallbackAnalysis, localParts, parseObservations } from "./lead-suite-insights.ts";

const TZ = "America/Argentina/Buenos_Aires"; // UTC-3, sin horario de verano
const lead = (id, contactStatus, extra = {}) => ({ id, name: `Lead ${id}`, category: "Inmobiliaria", city: "CABA", phone: "", website: "", batchId: "b", contactStatus, lastContactedAt: null, ...extra });
let n = 0;
const contact = (leadId, channel, status, contactedAt) => ({ id: `c${++n}`, leadId, leadName: `Lead ${leadId}`, channel, message: "", status, notes: "", contactedAt, created: contactedAt });

// Hora local: 18:30Z = 15:30 en Buenos Aires; 2026-11-09 es lunes.
assert.deepEqual(localParts("2026-11-09T18:30:00.000Z", TZ), { date: "2026-11-09", weekday: 0, hour: 15 });
assert.deepEqual(localParts("2026-11-10T02:00:00.000Z", TZ), { date: "2026-11-09", weekday: 0, hour: 23 });

const now = new Date("2026-11-13T12:00:00.000Z");
const leads = [
  lead("a", "replied", { lastContactedAt: "2026-11-10T13:00:00.000Z", category: "Inmobiliaria", city: "CABA" }),
  lead("b", "contacted", { lastContactedAt: "2026-11-05T13:00:00.000Z", category: "Inmobiliaria", city: "CABA" }),
  lead("c", "won", { lastContactedAt: "2026-11-12T13:00:00.000Z", category: "Veterinaria", city: "Rosario" }),
  lead("d", "contacted", { lastContactedAt: "2026-11-12T20:00:00.000Z", category: "Veterinaria", city: "Rosario" }),
  lead("p", "contacted", { lastContactedAt: "2026-10-20T13:00:00.000Z" }),
];
const contacts = [
  // período actual: 2026-11-07 .. 2026-11-13
  contact("a", "whatsapp", "contacted", "2026-11-09T13:00:00.000Z"),
  contact("a", "whatsapp", "replied", "2026-11-10T13:00:00.000Z"), // respondió 24 h después
  contact("b", "email", "contacted", "2026-11-09T13:00:00.000Z"),
  contact("c", "whatsapp", "contacted", "2026-11-11T13:00:00.000Z"),
  contact("c", "whatsapp", "won", "2026-11-12T01:00:00.000Z"), // 12 h después
  contact("d", "email", "contacted", "2026-11-12T20:00:00.000Z"),
  // período anterior: 2026-11-01 .. 2026-11-07
  contact("p", "phone", "contacted", "2026-11-02T13:00:00.000Z"),
];

const m = computeInsightMetrics(contacts, leads, { from: "2026-11-07T03:00:00.000Z", to: "2026-11-13T12:00:00.000Z", timeZone: TZ, now });

assert.equal(m.totalContacts, 6);
assert.deepEqual(m.kpis.contacts, { value: 6, previous: 1 });
assert.equal(m.kpis.replyRate.value, 0.5); // a y c de 4 leads
assert.equal(m.kpis.replyRate.previous, 0);
assert.equal(m.kpis.avgReplyHours.value, 18); // (24 + 12) / 2
assert.equal(m.kpis.avgReplyHours.previous, null);
assert.deepEqual(m.kpis.bestChannel, { channel: "whatsapp", replyRate: 1, leads: 2 });
assert.deepEqual(m.kpis.bestHour, { hour: 10, replyRate: 2 / 3, leads: 3 }); // a, b y c: primer contacto 13:00Z = 10 h local; respondieron a y c
assert.equal(m.kpis.overdue, 2); // b (8 días) y p (24 días); d tiene < 3 días
assert.deepEqual(m.overdue.map((item) => item.id), ["p", "b"]);

assert.deepEqual(m.funnel.map((stage) => [stage.stage, stage.count]), [["contacted", 4], ["replied", 2], ["meeting", 1], ["won", 1]]);
assert.equal(m.funnel[0].rateFromPrev, null);
assert.equal(m.funnel[1].rateFromPrev, 0.5);
assert.equal(m.funnel[3].rateFromPrev, 1);

assert.deepEqual(m.channels.map((c) => [c.channel, c.sent, c.leads, c.replied]), [["whatsapp", 4, 2, 2], ["email", 2, 2, 0]]);
assert.equal(m.trendUnit, "day");
assert.equal(m.trend.length, 7);
assert.equal(m.trend[0].date, "2026-11-07");
assert.deepEqual(m.trend.find((d) => d.date === "2026-11-09"), { date: "2026-11-09", sent: 2, replies: 0 });
assert.deepEqual(m.trend.find((d) => d.date === "2026-11-11"), { date: "2026-11-11", sent: 1, replies: 1 }); // 01:00Z del 12 = 22 h local del 11
assert.equal(m.heat.sent[0][10], 2); // lunes 10 h
assert.equal(m.heat.replies[1][10], 1); // martes 10 h
assert.equal(m.heat.sent.flat().reduce((a, b) => a + b, 0), 4);
assert.deepEqual(m.categories.map((g) => [g.name, g.leads, g.replied]), [["Inmobiliaria", 2, 1], ["Veterinaria", 2, 1]]);

// Rango largo → semanal, con lunes locales.
const weekly = computeInsightMetrics(contacts, leads, { from: "2026-08-15T03:00:00.000Z", to: "2026-11-13T12:00:00.000Z", timeZone: TZ, now });
assert.equal(weekly.trendUnit, "week");
assert.ok(weekly.trend.every((w) => new Date(`${w.date}T00:00:00Z`).getUTCDay() === 1));
assert.equal(weekly.trend.reduce((s, w) => s + w.sent + w.replies, 0), 7);

// Fallback honesto con pocos datos; con datos, nombra canal y vencidos.
const sparse = computeInsightMetrics(contacts.slice(0, 2), leads, { from: "2026-11-07T03:00:00.000Z", to: "2026-11-13T12:00:00.000Z", timeZone: TZ, now });
const few = fallbackAnalysis(sparse, "es", now);
assert.equal(few.insufficient, true);
assert.match(few.observations[0], /2 contactos/);
assert.ok(few.observations.length >= 3 && few.observations.length <= 5);
const full = fallbackAnalysis(m, "en", now);
assert.equal(full.insufficient, false);
assert.ok(full.observations.some((o) => o.includes("WhatsApp")));
assert.ok(full.observations.some((o) => o.includes("2 overdue")));
assert.ok(full.observations.length >= 3 && full.observations.length <= 5);

// Validación de la respuesta del modelo.
assert.deepEqual(parseObservations('{"observations":["a","b","c"]}'), ["a", "b", "c"]);
assert.equal(parseObservations('{"observations":["a","b"]}'), null);
assert.equal(parseObservations("no json"), null);
assert.deepEqual(parseObservations('{"observations":["a",1,"b",""," c "]}'), ["a", "b", "c"]); // descarta no-strings y vacíos, recorta
assert.equal(parseObservations('{"observations":["a","b","c","d","e","f"]}').length, 5);

console.log("lead-suite-insights selfcheck OK");
