// Headless self-check of the pure contact extraction: node --experimental-strip-types scripts/contact-scrape-selfcheck.mjs
import assert from "node:assert/strict";
import { contactPageLinks, extractContacts, isPrivateAddress, isValidEmail, normalizePhone, socialNetworkOf } from "../lib/server/contact-scrape.ts";

const html = `
  <a href="mailto:Info@Pizzeria.com.ar?subject=hola">Escribinos</a>
  <a href="tel:+54 11 4567-8900">Llamar</a>
  <a href="https://wa.me/5491145678900">WhatsApp</a>
  <a href="https://www.instagram.com/pizzeria_ok/">IG</a>
  <a href="https://www.facebook.com/sharer/sharer.php?u=x">Compartir</a>
  <a href="https://facebook.com/PizzeriaOk">FB</a>
  <a href="/contacto">Contacto</a>
  <a href="https://otro.com/contacto">Externo</a>
  <img src="logo@2x.png">
  <script>var x = "tracker@sentry.io";</script>`;
const found = extractContacts(html, "https://pizzeria.com.ar/");
assert.equal(found.email, "info@pizzeria.com.ar");
assert.equal(found.phone, "+541145678900");
assert.equal(found.whatsapp, "+5491145678900");
assert.equal(found.socials.get("instagram"), "https://www.instagram.com/pizzeria_ok");
assert.equal(found.socials.get("facebook"), "https://facebook.com/PizzeriaOk", "sharer link skipped");
assert.deepEqual(contactPageLinks(found.links, "https://pizzeria.com.ar/"), ["https://pizzeria.com.ar/contacto"], "only same-host contact pages");

assert.equal(extractContacts("<p>ventas&#64;local.com</p>", "https://local.com").email, "ventas@local.com", "entity-encoded text email");
assert.equal(extractContacts("<p>logo@2x.png user@example.com</p>", "https://a.com").email, "", "asset and template emails rejected");
assert.ok(isValidEmail("a.b@dominio.com.ar") && !isValidEmail("nope@") && !isValidEmail("x@sentry.io"));
assert.equal(normalizePhone("0054 11 4567 8900"), "+541145678900");
assert.equal(normalizePhone("123"), "");
assert.equal(socialNetworkOf("https://www.instagram.com/p/abc123"), null, "post, not profile");
assert.equal(socialNetworkOf("https://youtube.com/@canal"), "youtube");
assert.equal(socialNetworkOf("https://evil-instagram.com/x"), null, "lookalike host");

for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) assert.ok(isPrivateAddress(ip), ip);
for (const ip of ["8.8.8.8", "172.32.0.1", "2001:4860:4860::8888"]) assert.ok(!isPrivateAddress(ip), ip);
console.log("contact-scrape self-check OK");
