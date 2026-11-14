import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { register } from "node:module";
import { pathToFileURL } from "node:url";

// Resolve the "@/..." alias (tsconfig paths) to project .ts files so the server modules load under plain Node.
// PocketBase is stubbed: these checks never touch the database (and its file uses syntax strip-types can't run).
const root = pathToFileURL(new URL("../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")).href;
const hooks = `export async function resolve(specifier, context, next) {
  if (specifier === "@/lib/server/pocketbase") return { url: "data:text/javascript,export async function pocketBaseFetch(){throw new Error('no db in selfcheck')}", shortCircuit: true };
  if (specifier.startsWith("@/")) return next(${JSON.stringify(root)} + specifier.slice(2) + ".ts", context);
  return next(specifier, context);
}`;
register(`data:text/javascript,${encodeURIComponent(hooks)}`);

const { encryptToken, decryptToken, mergeFiles, parseFiles, GOOGLE_MAX_FILES, GoogleFilesLimitError } = await import("./google-connections.ts");
const { valuesToTable, driveQueryLiteral } = await import("./google-drive.ts");

// Encryption round trip, random IV, tamper and wrong key rejected.
const key = randomBytes(32).toString("base64");
const secret = "ya29.a0-secret-token_ñ";
const sealed = encryptToken(secret, key);
assert.ok(sealed.startsWith("v1.") && !sealed.includes(secret));
assert.equal(decryptToken(sealed, key), secret);
assert.notEqual(encryptToken(secret, key), sealed);
const body = Buffer.from(sealed.slice(3), "base64url");
body[body.length - 1] ^= 1;
assert.throws(() => decryptToken(`v1.${body.toString("base64url")}`, key));
assert.throws(() => decryptToken(sealed.slice(0, 20), key));
assert.throws(() => decryptToken(sealed, randomBytes(32).toString("base64")));
assert.throws(() => decryptToken("plain", key));
assert.throws(() => encryptToken(secret, randomBytes(16).toString("base64")), /32 bytes/);

// Sheets values → columns/rows.
const table = valuesToTable([["Nombre", "Teléfono", "", "nombre"], [], ["Ana", 1134, true], ["Luis", "", "x", "y", "extra"]]);
assert.deepEqual(table.columns, ["Nombre", "Teléfono", "Column 3", "nombre 2", "Column 5"]);
assert.deepEqual(table.rows, [["Ana", "1134", "true", "", ""], ["Luis", "", "x", "y", "extra"]]);
assert.equal(table.totalRows, 2);
assert.equal(table.truncated, false);
assert.deepEqual(valuesToTable(undefined), { columns: [], rows: [], totalRows: 0, truncated: false });

// Limits: rows, columns, cell length.
const many = valuesToTable([["a"], ...Array.from({ length: 30 }, (_, i) => [String(i)])], { maxRows: 10 });
assert.equal(many.rows.length, 10);
assert.equal(many.totalRows, 30);
assert.equal(many.truncated, true);
const wide = valuesToTable([Array.from({ length: 80 }, (_, i) => `c${i}`), ["v"]]);
assert.equal(wide.columns.length, 50);
assert.equal(wide.truncated, true);
assert.equal(valuesToTable([["h"], ["x".repeat(2000)]]).rows[0][0].length, 500);

// Drive query escaping.
assert.equal(driveQueryLiteral("O'Brien \\ x"), "'O\\'Brien \\\\ x'");

// Connected files: dedupe, newest first, invalid dropped, max 50.
const now = new Date("2026-11-13T10:00:00Z");
const first = mergeFiles([], [{ id: "a1", name: "A", mimeType: "text/csv", url: "https://drive.google.com/a" }], now);
const second = mergeFiles(first, [{ id: "b2", name: "B", mimeType: "", url: "javascript:alert(1)" }, { id: "a1", name: "A v2", mimeType: "text/csv", url: "" }, { id: "../x", name: "bad", mimeType: "", url: "" }], now);
assert.deepEqual(second.map((f) => f.id), ["b2", "a1"]);
assert.equal(second[0].url, "");
assert.equal(second[1].name, "A v2");
assert.equal(second[0].addedAt, now.toISOString());
const full = Array.from({ length: GOOGLE_MAX_FILES }, (_, i) => ({ id: `f${i}`, name: `F${i}`, mimeType: "", url: "" }));
assert.equal(mergeFiles([], full, now).length, 50);
assert.throws(() => mergeFiles(mergeFiles([], full, now), [{ id: "extra", name: "x", mimeType: "", url: "" }], now), GoogleFilesLimitError);
assert.deepEqual(parseFiles("nope"), []);

// ---------- Scopes (incremental consent) ----------
const { googleScopes, parseGoogleFeatures, mergeScopes, scopesInclude, grantedFeatures, GOOGLE_SCOPES } = await import("./google-connections.ts");
assert.deepEqual(parseGoogleFeatures("gmail, CALENDAR,foo,gmail"), ["gmail", "calendar"]);
assert.deepEqual(parseGoogleFeatures(null), []);
assert.deepEqual(googleScopes(), ["openid", "email", GOOGLE_SCOPES.driveFile]);
assert.deepEqual(googleScopes(["calendar"]), ["openid", "email", GOOGLE_SCOPES.driveFile, GOOGLE_SCOPES.calendarEvents]);
const merged = mergeScopes(`openid email ${GOOGLE_SCOPES.driveFile}`, `${GOOGLE_SCOPES.gmailSend} openid`);
assert.equal(merged, `openid email ${GOOGLE_SCOPES.driveFile} ${GOOGLE_SCOPES.gmailSend}`);
assert.ok(scopesInclude(merged, GOOGLE_SCOPES.gmailSend));
assert.ok(!scopesInclude(merged, GOOGLE_SCOPES.calendarEvents));
assert.deepEqual(grantedFeatures(merged), ["gmail"]);

// ---------- Gmail MIME ----------
const gmail = await import("./google-gmail.ts");
assert.ok(gmail.isValidEmail("ana.perez+leads@dominio.com.ar"));
for (const bad of ["", "ana", "ana@", "@x.com", "a b@x.com", "ana@x", "ana..b@x.com", "a@x.com\r\nBcc: z@y.com"]) assert.ok(!gmail.isValidEmail(bad), bad);
assert.equal(gmail.base64url("¿?>>~ñ"), Buffer.from("¿?>>~ñ").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
assert.ok(!/[+/=]/.test(gmail.base64url("????>>>>~~~~ñ")));
assert.equal(gmail.encodeHeaderValue("Plain subject"), "Plain subject");
const subject = "Propuesta para tu inmobiliaria 🚀 — ¿hablamos? ñandú ".repeat(3).trim();
const words = gmail.encodeHeaderValue(subject).split("\r\n ");
assert.ok(words.length > 1 && words.every((word) => /^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/.test(word) && word.length <= 75));
assert.equal(words.map((word) => Buffer.from(word.slice(10, -2), "base64").toString("utf8")).join(""), subject);
const mime = gmail.buildMimeMessage({ to: "lead@example.com", subject: "Hola 👋", text: "Línea 1\nLínea 2", replyTo: "yo@example.com", footer: "Para no recibir más mails, respondé BAJA.", listUnsubscribe: "mailto:yo@example.com?subject=baja" }, "B");
assert.ok(mime.includes("To: lead@example.com\r\n") && mime.includes("Reply-To: yo@example.com") && mime.includes("List-Unsubscribe: <mailto:yo@example.com?subject=baja>"));
assert.ok(mime.includes(`Subject: =?UTF-8?B?${Buffer.from("Hola 👋").toString("base64")}?=`));
assert.ok(!mime.includes("multipart") && mime.includes('Content-Type: text/plain; charset="UTF-8"'));
const plainBody = Buffer.from(mime.split("\r\n\r\n")[1].replace(/\r\n/g, ""), "base64").toString("utf8");
assert.equal(plainBody, "Línea 1\nLínea 2\n\n--\nPara no recibir más mails, respondé BAJA.");
const multi = gmail.buildMimeMessage({ to: "lead@example.com", subject: "Hi", text: "t", html: "<p>h</p>", footer: "<b>baja</b>" }, "BND");
assert.ok(multi.includes('multipart/alternative; boundary="BND"') && multi.endsWith("--BND--"));
const htmlPart = multi.split("--BND\r\n")[2].split("\r\n\r\n")[1].split("\r\n--BND--")[0];
assert.ok(Buffer.from(htmlPart.replace(/\r\n/g, ""), "base64").toString("utf8").includes("&#60;b&#62;baja&#60;/b&#62;"));
// Validation and limits; header injection rejected or flattened.
const base = { to: "lead@example.com", subject: "Hola", text: "Cuerpo" };
const fieldOf = (input) => { try { gmail.validateGmailInput(input); return null; } catch (error) { return error.field; } };
assert.equal(fieldOf(base), null);
assert.equal(fieldOf({ ...base, to: "x@y.com\r\nBcc: z@y.com" }), "to");
assert.equal(fieldOf({ ...base, subject: "s".repeat(201) }), "subject");
assert.equal(fieldOf({ ...base, subject: "   " }), "subject");
assert.equal(fieldOf({ ...base, text: "t".repeat(20001) }), "text");
assert.equal(fieldOf({ ...base, replyTo: "nope" }), "replyTo");
assert.equal(fieldOf({ ...base, listUnsubscribe: "javascript:alert(1)" }), "listUnsubscribe");
assert.equal(gmail.validateGmailInput({ ...base, subject: "Hola\r\nBcc: z@y.com" }).subject, "Hola Bcc: z@y.com");
// Typed Google errors.
assert.ok(gmail.gmailErrorFrom(429, null) instanceof gmail.GmailQuotaError);
assert.ok(gmail.gmailErrorFrom(403, { error: { errors: [{ reason: "dailyLimitExceeded" }] } }) instanceof gmail.GmailQuotaError);
assert.ok(gmail.gmailErrorFrom(403, { error: { status: "PERMISSION_DENIED", errors: [{ reason: "insufficientPermissions" }] } }) instanceof gmail.GmailNotConnectedError);
assert.ok(gmail.gmailErrorFrom(500, null) instanceof gmail.GmailSendError);

// ---------- Batch throttle (mocked send/sleep) ----------
const item = (n) => ({ to: `lead${n}@example.com`, subject: `S${n}`, text: `T${n}` });
const log = [];
const okBatch = await gmail.sendGmailBatch("u1", [item(1), { ...item(2), to: "bad" }, item(3), item(4)], {
  delayMs: 20000,
  max: 3,
  send: async (_user, input) => { log.push(`send:${input.to}`); return { id: `id-${input.to}`, threadId: "t" }; },
  sleep: async (ms) => { log.push(`wait:${ms}`); },
});
assert.deepEqual(log, ["send:lead1@example.com", "wait:20000", "send:lead3@example.com"]);
assert.deepEqual(okBatch.results.map((r) => [r.index, r.ok]), [[0, true], [1, false], [2, true]]);
assert.equal(okBatch.results[1].field, "to");
assert.deepEqual([okBatch.sent, okBatch.failed, okBatch.skipped, okBatch.stoppedBy], [2, 1, 1, null]);
let calls = 0;
const quotaSend = async () => { calls++; if (calls === 2) throw new gmail.GmailQuotaError(); return { id: "x", threadId: "t" }; };
const quotaBatch = await gmail.sendGmailBatch("u1", [item(1), item(2), item(3), item(4)], { delayMs: 5, send: quotaSend, sleep: async () => {} });
assert.deepEqual([quotaBatch.sent, quotaBatch.failed, quotaBatch.skipped, quotaBatch.stoppedBy, calls], [1, 1, 2, "quota", 2]);
const cap = await gmail.sendGmailBatch("u1", Array.from({ length: 60 }, (_, n) => item(n)), { max: 500, delayMs: 0, send: async () => ({ id: "x", threadId: "t" }) });
assert.deepEqual([cap.sent, cap.skipped], [50, 10]);
const controller = new AbortController();
const abortBatch = await gmail.sendGmailBatch("u1", [item(1), item(2)], { send: async () => { controller.abort(); return { id: "x", threadId: "t" }; }, sleep: async () => {}, signal: controller.signal });
assert.deepEqual([abortBatch.sent, abortBatch.stoppedBy, abortBatch.skipped], [1, "aborted", 1]);

// ---------- Calendar payload ----------
const calendar = await import("./google-calendar.ts");
const event = calendar.buildEventPayload({ title: "Reunión con Inmobiliaria Ñ", start: "2026-11-20T15:00:00-03:00", end: "2026-11-20T15:30:00-03:00", timeZone: "America/Argentina/Buenos_Aires", description: "Dolores: demoras", attendees: ["Lead@Example.com", "lead@example.com", "otro@example.com"], meet: true }, { requestId: "req-1" });
assert.deepEqual(event.body, {
  summary: "Reunión con Inmobiliaria Ñ",
  description: "Dolores: demoras",
  start: { dateTime: "2026-11-20T15:00:00-03:00", timeZone: "America/Argentina/Buenos_Aires" },
  end: { dateTime: "2026-11-20T15:30:00-03:00", timeZone: "America/Argentina/Buenos_Aires" },
  attendees: [{ email: "lead@example.com" }, { email: "otro@example.com" }],
  conferenceData: { createRequest: { requestId: "req-1", conferenceSolutionKey: { type: "hangoutsMeet" } } },
});
assert.equal(event.params.get("conferenceDataVersion"), "1");
assert.equal(event.params.get("sendUpdates"), "all");
const solo = calendar.buildEventPayload({ title: "Solo", start: "2026-11-20T15:00", end: "2026-11-20T16:00", timeZone: "UTC" });
assert.equal(solo.params.get("sendUpdates"), "none");
assert.equal(solo.params.get("conferenceDataVersion"), null);
assert.equal(solo.body.attendees, undefined);
const calField = (input, opts) => { try { calendar.buildEventPayload(input, opts); return null; } catch (error) { return error.field; } };
const okEvent = { title: "x", start: "2026-11-20T15:00", end: "2026-11-20T16:00", timeZone: "UTC" };
assert.equal(calField(okEvent), null);
assert.equal(calField({ ...okEvent, end: "2026-11-20T14:00" }), "end");
assert.equal(calField({ ...okEvent, timeZone: "Mars/Base" }), "timeZone");
assert.equal(calField({ ...okEvent, start: "mañana" }), "start");
assert.equal(calField({ ...okEvent, title: "" }), "title");
assert.equal(calField({ ...okEvent, attendees: ["no-es-mail"] }), "attendees");
const patch = calendar.buildEventPayload({ title: "Nuevo título" }, { partial: true });
assert.deepEqual(patch.body, { summary: "Nuevo título" });
assert.equal(patch.params.get("sendUpdates"), "all");
assert.deepEqual(calendar.eventResult({ id: "e1", htmlLink: "https://calendar.google.com/e1", conferenceData: { entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/abc" }] } }), { id: "e1", htmlLink: "https://calendar.google.com/e1", meetLink: "https://meet.google.com/abc" });
assert.deepEqual(calendar.eventResult({ id: "e2", htmlLink: "h" }), { id: "e2", htmlLink: "h" });

console.log("google selfcheck ok");
