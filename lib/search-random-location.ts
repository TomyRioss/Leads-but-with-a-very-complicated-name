// Ubicación aleatoria: reparto de un lote entre los 10 países de mayor PIB nominal. Editá la lista para cambiar el conjunto.
export const RANDOM_LOCATION_COUNTRIES = [
  "United States",
  "China",
  "Germany",
  "Japan",
  "India",
  "United Kingdom",
  "France",
  "Italy",
  "Canada",
  "Brazil",
] as const;

export type RandomSearchSlot = { keyword: string; country: string; limit: number };

/** Reparte `total` en `parts` cantidades que difieren como mucho en 1 y suman exactamente `total`. */
export function splitEvenly(total: number, parts: number): number[] {
  if (parts <= 0) return [];
  const base = Math.floor(total / parts);
  const extra = total % parts;
  return Array.from({ length: parts }, (_, index) => base + (index < extra ? 1 : 0));
}

/**
 * Plan de búsqueda: cada lead se asigna por turnos a un país (parejo entre países) y, dentro de cada país,
 * por turnos a una keyword (parejo entre keywords). La suma de límites es exactamente `count`.
 * `offset` rota qué países reciben el lead extra (en el servidor se sortea para que no sea siempre el mismo).
 */
export function planRandomSearch(count: number, keywords: string[], offset = 0): RandomSearchSlot[] {
  const countries = RANDOM_LOCATION_COUNTRIES;
  if (count <= 0 || keywords.length === 0) return [];
  const limits = new Map<string, number>();
  const perCountry = new Array<number>(countries.length).fill(0);
  for (let index = 0; index < count; index++) {
    const countryIndex = (offset + index) % countries.length;
    const keyword = keywords[(countryIndex + perCountry[countryIndex]++) % keywords.length];
    const key = `${countryIndex}|${keyword}`;
    limits.set(key, (limits.get(key) ?? 0) + 1);
  }
  return [...limits].map(([key, limit]) => {
    const [countryIndex, ...keywordParts] = key.split("|");
    return { country: countries[Number(countryIndex)], keyword: keywordParts.join("|"), limit };
  });
}

// Deadline global del modo aleatorio: la ruta corta a los 300 s, así que se deja margen para guardar el lote y liquidar créditos.
export const RANDOM_DEADLINE_MS = 240_000;
export const RANDOM_CALL_MARGIN_MS = 20_000;
export const RANDOM_MIN_START_MS = 30_000;

/**
 * Timeout (ms) para la próxima llamada a Apify según lo transcurrido desde el inicio de la búsqueda:
 * el mínimo entre su timeout habitual y lo que queda hasta el deadline menos el margen.
 * Devuelve 0 si quedan menos de RANDOM_MIN_START_MS: no hay que arrancar la llamada.
 */
export function remainingCallTimeoutMs(elapsedMs: number, callTimeoutMs = 300_000): number {
  const left = RANDOM_DEADLINE_MS - elapsedMs;
  if (left < RANDOM_MIN_START_MS) return 0;
  return Math.min(callTimeoutMs, left - RANDOM_CALL_MARGIN_MS);
}
