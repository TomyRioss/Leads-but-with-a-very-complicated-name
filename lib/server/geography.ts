import { getCitiesOfState, getCountries, getStatesOfCountry } from "@countrystatecity/countries";

// Resolución server-side de ubicaciones contra el dataset que expone /api/geography.
// Los nombres canónicos son los mismos que ve el cliente, así el texto enviado a Apify
// (y el monitor de "ya vistos" que se deriva de él) no cambia para búsquedas válidas.

type State = Awaited<ReturnType<typeof getStatesOfCountry>>[number];
type Index<T> = Map<string, T>;
type CountryEntry = { iso2: string; name: string };
type StateEntry = { code: string; name: string };

const displayNamesEs = new Intl.DisplayNames(["es"], { type: "region" });
const displayNamesEn = new Intl.DisplayNames(["en"], { type: "region" });
const MAX_CACHED_CITY_INDEXES = 128;

/** Nombre de país que muestra /api/geography. */
export function countryDisplayName(iso2: string, fallback: string): string {
  return displayNamesEs.of(iso2) || fallback;
}

/** Nombre de provincia que muestra /api/geography. */
export function stateDisplayName(state: Pick<State, "name" | "native" | "translations">): string {
  return state.translations?.es || state.native || state.name;
}

/** Minúsculas, sin tildes ni puntuación, espacios colapsados. */
export function normalizePlace(value: string): string {
  return value.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Inserta alias en orden de prioridad: el primero que ocupa una clave la conserva. */
function addAliases<T>(index: Index<T>, entry: T, aliases: (string | null | undefined)[]) {
  for (const alias of aliases) {
    const key = alias ? normalizePlace(alias) : "";
    if (key && !index.has(key)) index.set(key, entry);
  }
}

let countryIndex: Promise<Index<CountryEntry>> | null = null;
const stateIndexes = new Map<string, Promise<Index<StateEntry>>>();
const cityIndexes = new Map<string, Promise<Index<string>>>();

/** Carga una vez por proceso; si falla se descarta para reintentar en la próxima solicitud. */
function cached<T>(promise: Promise<T>, drop: () => void): Promise<T> {
  promise.catch(drop);
  return promise;
}

function getCountryIndex() {
  countryIndex ??= cached((async () => {
    const countries = await getCountries();
    if (countries.length === 0) throw new Error("Countries dataset is empty.");
    const index: Index<CountryEntry> = new Map();
    const entries = countries.map((country) => ({ country, entry: { iso2: country.iso2, name: countryDisplayName(country.iso2, country.name) } }));
    // Prioridad: nombre mostrado > nombre del dataset > inglés > nativo > códigos.
    for (const { entry } of entries) addAliases(index, entry, [entry.name]);
    for (const { country, entry } of entries) addAliases(index, entry, [country.name, displayNamesEn.of(country.iso2), country.native]);
    for (const { country, entry } of entries) addAliases(index, entry, [country.iso2, country.iso3]);
    return index;
  })(), () => { countryIndex = null; });
  return countryIndex;
}

function getStateIndex(iso2: string) {
  let index = stateIndexes.get(iso2);
  if (!index) {
    index = cached((async () => {
      const states = (await getStatesOfCountry(iso2)).filter((state) => state.iso2);
      if (states.length === 0) throw new Error(`No states for ${iso2}.`);
      const result: Index<StateEntry> = new Map();
      const entries = states.map((state) => ({ state, entry: { code: state.iso2, name: stateDisplayName(state) } }))
        .filter(({ entry }) => entry.name);
      for (const { entry } of entries) addAliases(result, entry, [entry.name]);
      for (const { state, entry } of entries) addAliases(result, entry, [state.name, state.native, state.translations?.en]);
      for (const { state, entry } of entries) addAliases(result, entry, [state.iso2, state.iso3166_2]);
      for (const { state, entry } of entries) addAliases(result, entry, Object.values(state.translations ?? {}));
      return result;
    })(), () => stateIndexes.delete(iso2));
    stateIndexes.set(iso2, index);
  }
  return index;
}

function getCityIndex(iso2: string, stateCode: string) {
  const key = `${iso2}|${stateCode}`;
  let index = cityIndexes.get(key);
  if (index) {
    cityIndexes.delete(key); // LRU: se reinserta al final.
  } else {
    index = cached((async () => {
      const cities = await getCitiesOfState(iso2, stateCode);
      if (cities.length === 0) throw new Error(`No cities for ${key}.`);
      const result: Index<string> = new Map();
      const entries = cities.map((city) => ({ city, name: city.name.trim() })).filter(({ name }) => name);
      for (const { name } of entries) addAliases(result, name, [name]);
      for (const { city, name } of entries) addAliases(result, name, [String(city.id), city.native, ...Object.values(city.translations ?? {})]);
      return result;
    })(), () => cityIndexes.delete(key));
  }
  cityIndexes.set(key, index);
  if (cityIndexes.size > MAX_CACHED_CITY_INDEXES) cityIndexes.delete(cityIndexes.keys().next().value!);
  return index;
}

export type ResolvedLocation = { countryCode: string; country: string; province: string; district: string };
export type LocationResolution =
  | { ok: true; location: ResolvedLocation }
  | { ok: false; field: "country" | "province" | "district" };

/**
 * Resuelve país, provincia y distrito (nombres localizados/nativos/ingleses o códigos ISO/ids del dataset)
 * a sus nombres canónicos. Un valor desconocido, o un distrito sin provincia, se rechaza.
 * Lanza solo si el dataset no se puede cargar.
 */
export async function resolveLocation(country: string, province: string, district: string): Promise<LocationResolution> {
  const resolvedCountry = (await getCountryIndex()).get(normalizePlace(country));
  if (!resolvedCountry) return { ok: false, field: "country" };
  const location: ResolvedLocation = { countryCode: resolvedCountry.iso2, country: resolvedCountry.name, province: "", district: "" };
  if (!province) return district ? { ok: false, field: "district" } : { ok: true, location };

  const states = await getStateIndex(resolvedCountry.iso2).catch(() => null);
  const resolvedState = states?.get(normalizePlace(province));
  if (!resolvedState) return { ok: false, field: "province" };
  location.province = resolvedState.name;
  if (!district) return { ok: true, location };

  const cities = await getCityIndex(resolvedCountry.iso2, resolvedState.code).catch(() => null);
  const resolvedCity = cities?.get(normalizePlace(district));
  if (!resolvedCity) return { ok: false, field: "district" };
  location.district = resolvedCity;
  return { ok: true, location };
}
