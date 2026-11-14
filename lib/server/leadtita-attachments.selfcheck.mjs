// Self-check for Leadtita attachments: magic bytes, CSV parsing/mapping, truncation and context re-validation. No network.
// Run: node --experimental-strip-types lib/server/leadtita-attachments.selfcheck.mjs
import assert from "node:assert/strict";

const m = await import(new URL("./leadtita-attachments.ts", import.meta.url).href);
const bytes = (...values) => new Uint8Array(values);
const utf8 = (text) => new TextEncoder().encode(text);

// Magic bytes decide the type; the extension only picks between text formats.
assert.equal(m.sniffKind(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0), "x.png").kind, "image");
assert.equal(m.sniffKind(bytes(0xff, 0xd8, 0xff, 0xe0), "foto.csv").mime, "image/jpeg", "content wins over extension");
assert.equal(m.sniffKind(utf8("RIFF\0\0\0\0WEBPVP8 "), "a.webp").mime, "image/webp");
assert.equal(m.sniffKind(utf8("%PDF-1.7\n"), "doc.pdf").kind, "pdf");
assert.equal(m.sniffKind(utf8("%PDF-1.7\n"), "doc.txt").kind, "pdf");
assert.equal(m.sniffKind(utf8("# Hola"), "notas.md").kind, "text");
assert.equal(m.sniffKind(utf8("a,b\n1,2"), "leads.csv").kind, "csv");
assert.equal(m.sniffKind(utf8("MZ\0\0binary"), "virus.csv"), null, "binary disguised as csv");
assert.equal(m.sniffKind(utf8("<html>"), "page.html"), null, "unsupported extension");
assert.equal(m.sniffKind(bytes(0xc3, 0x28), "bad.txt"), null, "invalid UTF-8");

// CSV: quotes, escaped quotes, newlines in quotes, ; separator, BOM, CRLF, Spanish headers.
const semicolon = "﻿Nombre;Rubro;Teléfono;E-mail;Web\r\n\"Panadería \"\"Lola\"\"\";Panadería;11 5555-1234;lola@mail.com;https://lola.com\r\nCafé Sur;\"Café; bar\";;;\r\n\r\n";
const parsed = m.parseCsv(semicolon);
assert.equal(parsed.delimiter, ";");
assert.equal(parsed.totalRows, 2);
assert.deepEqual(parsed.rows[1], ['Panadería "Lola"', "Panadería", "11 5555-1234", "lola@mail.com", "https://lola.com"]);
assert.equal(parsed.rows[2][1], "Café; bar");
const multiline = m.parseCsv('name,notes\n"A","line1\nline2"\n');
assert.equal(multiline.rows[1][1], "line1\nline2");
assert.equal(m.detectDelimiter('"a,b";c;d'), ";", "commas inside quotes don't count");

// Header mapping (es/en, accents, case).
assert.deepEqual(m.mapHeaders(["Nombre", "RUBRO", "Teléfono", "E-mail", "Sitio web", "Zona", "Algo raro"]), ["name", "category", "phone", "email", "website", "city", null]);
assert.deepEqual(m.mapHeaders(["Business", "Channel", "Date", "Message", "Status"]), ["name", "channel", "date", "message", "status"]);

const context = m.csvToContext("leads.csv", semicolon.length, semicolon);
assert.equal(context.kind, "csv");
assert.equal(context.csv.rows.length, 2);
assert.deepEqual(context.csv.rows[0], { name: 'Panadería "Lola"', category: "Panadería", phone: "11 5555-1234", email: "lola@mail.com", website: "https://lola.com" });
assert.deepEqual(context.csv.rows[1], { name: "Café Sur", category: "Café; bar" });

// Row limit: 2,000 usable rows; total still reported.
const big = "name\n" + Array.from({ length: 2100 }, (_, i) => `Lead ${i}`).join("\n");
const bigContext = m.csvToContext("big.csv", big.length, big);
assert.equal(bigContext.csv.rows.length, 2000);
assert.equal(bigContext.csv.totalRows, 2100);
assert.equal(bigContext.truncated, true);

// Truncation keeps head and tail and marks it.
const long = "A".repeat(5000) + "B".repeat(5000);
const cut = m.truncateText(long, 1000);
assert.equal(cut.truncated, true);
assert.ok(cut.text.startsWith("A".repeat(800)) && cut.text.endsWith("B".repeat(200)) && cut.text.includes("omitted"));
assert.deepEqual(m.truncateText("short", 1000), { text: "short", truncated: false });

// Sanitizing drops control and bidi characters.
assert.equal(m.sanitizeText("a\u0000b‮c\r\nd\n\n\n\ne"), "abc\nd\n\ne");

// Re-validation of contexts the client sends back.
assert.deepEqual(m.parseAttachmentContexts(undefined), []);
assert.equal(m.parseAttachmentContexts([{ name: "x", kind: "exe", size: 1, text: "" }]), null);
assert.equal(m.parseAttachmentContexts([{ ...context, csv: { ...context.csv, rows: [{ evil: "x" }] } }]), null, "unknown CSV fields rejected");
assert.equal(m.parseAttachmentContexts(Array(6).fill({ name: "a", kind: "text", size: 1, text: "a" })), null, "max 5 files");
assert.equal(m.parseAttachmentContexts([context])[0].csv.rows.length, 2);

// Prompt block is delimited and states the row count.
const block = m.attachmentPromptBlock(context);
assert.ok(block.startsWith('<attachment name="leads.csv" kind="csv">') && block.includes("2 data rows") && block.endsWith("</attachment>"));

// Extraction rejects by real type and size before any parsing.
await assert.rejects(m.extractAttachment({ name: "x.csv", bytes: utf8("MZ\0") }, { apiKey: "" }), (error) => error.code === "type");
await assert.rejects(m.extractAttachment({ name: "x.txt", bytes: new Uint8Array(0) }, { apiKey: "" }), (error) => error.code === "empty");
const md = await m.extractAttachment({ name: "notas.md", bytes: utf8("# Leads\n- Café Sur, Palermo") }, { apiKey: "" });
assert.equal(md.kind, "text");
assert.ok(md.text.includes("Café Sur"));

console.log("leadtita attachments selfcheck ok");
