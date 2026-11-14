// Headless self-check of Facebook item mapping and text contacts (no network).
// Run: node --experimental-strip-types lib/server/people/sources/meta.selfcheck.mjs
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";

const root = pathToFileURL(`${process.cwd()}/`).href;
const loader = `
export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(${JSON.stringify(root)} + specifier.slice(2) + ".ts", context);
  return next(specifier, context);
}`;
register(`data:text/javascript,${encodeURIComponent(loader)}`);

const { contactsFromText, mapFacebookPost, searchFacebookGroups } = await import("./meta.ts");
const plan = { role: "Limpieza", location: "Palermo, CABA" };

const bio = contactsFromText("Plomero matriculado. wsp +54 9 11 4444-3333 · mail juan.plomero@gmail.com");
assert.equal(bio.whatsapp, "+5491144443333");
assert.equal(bio.email, "juan.plomero@gmail.com");
assert.equal(contactsFromText("Sin contacto, 2024").phone, "");

const post = mapFacebookPost({
  text: "Hola grupo! Hago limpieza por horas en Palermo. WhatsApp 11 6666-7777",
  url: "https://www.facebook.com/groups/123/posts/456",
  user: { id: "100012345", name: "Laura P." },
  groupTitle: "Limpieza CABA",
}, plan);
assert.equal(post.name, "Laura P.");
assert.equal(post.whatsapp, "1166667777", "local number kept; country code added in enrich");
assert.equal(post.socialProfiles.facebook, "https://www.facebook.com/profile.php?id=100012345");
assert.equal(post.source, "facebook");
assert.equal(mapFacebookPost({ text: "Alguien recomienda plomero?", user: { name: "Ana" } }, plan), null, "no contact → skipped");

// Sin claves: no rompe, devuelve [].
delete process.env.APIFY_TOKEN;
delete process.env.SERPER_API_KEY;
assert.deepEqual(await searchFacebookGroups({ ...plan, instagramQueries: [], facebookGroupQueries: ["limpieza palermo"] }), []);

console.log("meta selfcheck ok");
