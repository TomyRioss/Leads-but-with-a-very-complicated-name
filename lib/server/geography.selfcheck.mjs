// Self-check headless (dataset local, sin red): node --experimental-strip-types lib/server/geography.selfcheck.mjs
import assert from "node:assert/strict";
import { getCitiesOfState } from "@countrystatecity/countries";
import { resolveLocation } from "./geography.ts";

const ok = async (args, expected) => {
  const result = await resolveLocation(...args);
  assert.equal(result.ok, true, `${args.join(" | ")} debería resolver`);
  assert.deepEqual(result.location, expected, args.join(" | "));
};
const rejected = async (args, field) => {
  const result = await resolveLocation(...args);
  assert.deepEqual(result, { ok: false, field }, args.join(" | "));
};

const spain = { countryCode: "ES", country: "España", province: "", district: "" };
// País: nombre mostrado, inglés, sin tildes/mayúsculas, ISO2 e ISO3.
for (const value of ["España", "Spain", "espana", "ES", "es", "ESP"]) await ok([value, "", ""], spain);
await ok(["Estados Unidos", "", ""], { countryCode: "US", country: "Estados Unidos", province: "", district: "" });
await ok(["Argentina", "", ""], { countryCode: "AR", country: "Argentina", province: "", district: "" });

// Provincia: nombre mostrado, nombre del dataset y código ISO de /api/geography.
const coruna = { ...spain, province: "A Coruña" };
for (const value of ["A Coruña", "a coruna", "C", "ES-C"]) await ok(["ES", value, ""], coruna);

// Distrito: nombre o id que expone /api/geography (code = String(city.id)).
const city = (await getCitiesOfState("ES", "C")).find((item) => item.name.trim());
await ok(["España", "A Coruña", city.name], { ...coruna, district: city.name.trim() });
await ok(["España", "C", String(city.id)], { ...coruna, district: city.name.trim() });

// Rechazos.
await rejected(["Narnia", "", ""], "country");
await rejected(["", "", ""], "country");
await rejected(["ES", "Virginia", ""], "province");
await rejected(["ES", "", "Madrid"], "district");
await rejected(["ES", "C", "Alexandria"], "district");
// Payload del reporte (códigos en vez de nombres): 151038 es el id de la ciudad A Coruña, así que se busca en España.
await ok(["ES", "C", "151038"], { ...coruna, district: "A Coruña" });

console.log("geography selfcheck ok");
