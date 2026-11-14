import assert from "node:assert/strict";
import { slugify, readingMinutes, BLOG_SLUG_PATTERN } from "./blog.ts";

assert.equal(slugify("Cómo vender más: guía 2026"), "como-vender-mas-guia-2026");
assert.equal(slugify("Ñandú y Pingüino"), "nandu-y-pinguino");
assert.equal(slugify("  ¿Qué es SEO?!  "), "que-es-seo");
assert.equal(slugify("Leads & Ventas / B2B"), "leads-y-ventas-b2b");
assert.equal(slugify("---"), "");
assert.equal(slugify("Ça va — très bien"), "ca-va-tres-bien");
const long = slugify("palabra ".repeat(40));
assert.ok(long.length <= 120 && BLOG_SLUG_PATTERN.test(long));
assert.ok(BLOG_SLUG_PATTERN.test(slugify("Hola Mundo 123")));

assert.equal(readingMinutes(""), 1);
assert.equal(readingMinutes("hola ".repeat(220)), 1);
assert.equal(readingMinutes("hola ".repeat(221)), 2);
assert.equal(readingMinutes("# Título\n\n" + "palabra ".repeat(440) + "\n```js\n" + "code ".repeat(1000) + "\n```"), 3); // fence ignored, title counts
assert.equal(readingMinutes("[enlace](https://x.com/a) ![img](a.png) - * #"), 1);
console.log("blog selfcheck ok");
