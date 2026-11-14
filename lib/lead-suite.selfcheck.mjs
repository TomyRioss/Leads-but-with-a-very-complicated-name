import assert from "node:assert/strict";
import { weekStartIso, normalizeChannel, normalizeLeadStatus, toPbDate, fromPbDate, computeLeadSuiteMetrics } from "./lead-suite.ts";

assert.equal(weekStartIso("2026-11-13T10:00:00Z"), "2026-11-09"); // Friday → Monday
assert.equal(weekStartIso("2026-11-09T00:00:00Z"), "2026-11-09");
assert.equal(weekStartIso("2026-11-15T23:59:00Z"), "2026-11-09"); // Sunday
assert.equal(normalizeChannel(" WhatsApp "), "whatsapp");
assert.equal(normalizeChannel("correo"), "email");
assert.equal(normalizeChannel("fax"), "other");
assert.equal(normalizeLeadStatus(""), "not_contacted");
assert.equal(normalizeLeadStatus("won"), "won");
assert.equal(toPbDate("2026-11-13T10:00:00Z"), "2026-11-13 10:00:00.000Z");
assert.equal(fromPbDate("2026-11-13 10:00:00.000Z"), "2026-11-13T10:00:00.000Z");
// Filter dates must use PocketBase's "YYYY-MM-DD HH:mm:ss.sssZ" (space, no "T"), from any input form.
for (const input of ["2026-11-13T10:00:00Z", "2026-11-13T07:00:00-03:00", new Date(Date.UTC(2026, 10, 13, 10))]) {
  assert.match(toPbDate(input), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(toPbDate(input), "2026-11-13 10:00:00.000Z");
}
assert.equal(fromPbDate(""), null);

const lead = (id, status, last, category) => ({ id, name: id, category, city: "", phone: "", website: "", batchId: "b", contactStatus: status, lastContactedAt: last });
const leads = new Map([
  ["a", lead("a", "contacted", "2026-11-01T12:00:00.000Z", "Inmobiliaria")],
  ["b", lead("b", "replied", "2026-11-12T13:00:00.000Z", "Inmobiliaria")],
  ["c", lead("c", "won", "2026-11-12T18:00:00.000Z", "Restaurante")],
  ["d", lead("d", "contacted", "2026-11-12T18:00:00.000Z", "")],
]);
const contacts = [
  { leadId: "a", channel: "whatsapp", contactedAt: "2026-11-01T12:00:00.000Z" },
  { leadId: "b", channel: "email", contactedAt: "2026-11-10T13:00:00.000Z" }, // 10:00 Buenos Aires
  { leadId: "b", channel: "whatsapp", contactedAt: "2026-11-12T13:00:00.000Z" },
  { leadId: "c", channel: "phone", contactedAt: "2026-11-12T18:00:00.000Z" }, // 15:00 Buenos Aires
  { leadId: "d", channel: "whatsapp", contactedAt: "2026-11-12T18:00:00.000Z" },
];
const now = new Date("2026-11-13T12:00:00Z");
const m = computeLeadSuiteMetrics(contacts, leads, { from: "2026-11-09T00:00:00.000Z", to: "2026-11-15T23:59:59.999Z" }, now);
assert.equal(m.totalContactedLeads, 4);
assert.equal(m.contactsInRange, 4);
assert.equal(m.leadsContactedInRange, 3);
assert.equal(m.byChannel.whatsapp, 2);
assert.equal(m.byChannel.email, 1);
assert.equal(m.byChannel.phone, 1);
assert.deepEqual({ ...m.byStatus }, { not_contacted: 0, contacted: 2, replied: 1, meeting: 0, won: 1, lost: 0 });
assert.equal(m.byWeek.length, 8);
assert.deepEqual(m.byWeek.at(-1), { weekStart: "2026-11-09", count: 4 });
assert.deepEqual(m.byWeek.at(-2), { weekStart: "2026-11-02", count: 0 });
assert.deepEqual(m.byWeek.at(-3), { weekStart: "2026-10-26", count: 1 });
assert.deepEqual(m.byCategory, [{ category: "Inmobiliaria", count: 1 }, { category: "Restaurante", count: 1 }]);
assert.equal(m.byHour.length, 24);
assert.equal(m.byHour[10], 2);
assert.equal(m.byHour[15], 2);
assert.equal(m.replyRate, 0.5);
assert.deepEqual(m.pendingFollowUps.map((l) => l.id), ["a"]);

const empty = computeLeadSuiteMetrics([], new Map(), { from: "2026-11-09T00:00:00Z", to: "2026-11-15T00:00:00Z" }, now);
assert.equal(empty.replyRate, 0);
assert.equal(empty.pendingFollowUps.length, 0);
console.log("lead-suite selfcheck ok");
