// Nombre de país ("Colombia", "Estados Unidos", "United States") → código ISO-3166 alfa-2 ("CO"), para dibujar su bandera.
// Sin dependencias: Intl.DisplayNames en es y en sobre todos los códigos AA–ZZ, armado una sola vez.

const LOCALES = ["es", "en"] as const;
let byName: Map<string, string> | null = null;

const normalize = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase();

function table() {
  if (byName) return byName;
  byName = new Map();
  const names = LOCALES.map((locale) => new Intl.DisplayNames([locale], { type: "region", fallback: "none" }));
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      for (const display of names) {
        let name: string | undefined;
        try {
          name = display.of(code);
        } catch {
          name = undefined;
        }
        if (name && !byName.has(normalize(name))) byName.set(normalize(name), code);
      }
    }
  }
  return byName;
}

/** Código ISO de dos letras, o "" si el nombre no es un país conocido. Acepta un código directo ("ar"). */
export function countryCode(name: string) {
  const value = normalize(name);
  if (!value) return "";
  if (/^[a-z]{2}$/.test(value)) return value.toUpperCase();
  return table().get(value) ?? "";
}

/** Bandera raster (flagcdn) del país; "" si no se reconoce. El emoji de bandera no se ve en Windows. */
export const flagUrl = (code: string) => (code ? `https://flagcdn.com/w40/${code.toLowerCase()}.png` : "");
