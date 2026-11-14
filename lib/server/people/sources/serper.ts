import type { PersonCandidate } from "@/lib/people";
import type { SocialNetwork } from "@/lib/types";
import { isValidEmail, normalizePhone, socialNetworkOf } from "@/lib/server/contact-scrape";

const SERPER_TIMEOUT_MS = 15_000;
const CONCURRENCY = 3;

/** Corre `task` sobre `items` con a lo sumo `limit` en paralelo, preservando el orden. */
export async function mapLimit<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]);
    }
  }));
  return results;
}

export function withTimeout(ms: number, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

// ponytail: país por palabra clave en la ubicación; default Argentina (mercado principal). Ampliar la tabla si hace falta.
const countries: [RegExp, string, string][] = [
  [/m[eé]xico|cdmx|guadalajara|monterrey/i, "mx", "es"],
  [/chile|santiago/i, "cl", "es"],
  [/uruguay|montevideo/i, "uy", "es"],
  [/colombia|bogot[aá]|medell[ií]n/i, "co", "es"],
  [/per[uú]\b|lima\b/i, "pe", "es"],
  [/espa[ñn]a|spain|madrid|barcelona|valencia/i, "es", "es"],
  [/united states|usa\b|new york|california|texas|miami/i, "us", "en"],
  [/united kingdom|\buk\b|london/i, "gb", "en"],
];
export function serperLocale(location: string): { gl: string; hl: string } {
  const hit = countries.find(([pattern]) => pattern.test(location));
  return hit ? { gl: hit[1], hl: hit[2] } : { gl: "ar", hl: "es" };
}

const businessPattern = /\b(s\.?r\.?l\.?|s\.?a\.?s?\.?|s\.?a\.?|ltda|inc\.?|llc|ltd|gmbh|empresa|compañ[ií]a|company|corporaci[oó]n|consultora|agencia|agency|estudio jur[ií]dico|grupo)\b/i;
const directoryHosts = /(paginasamarillas|guiaoleo|yelp|tripadvisor|foursquare|mercadolibre|olx|zonaprop|argenprop|cylex|infoisinfo|tuugo|habitissimo|computrabajo|indeed|glassdoor|bumeran|zonajobs|doctoralia|top-rated)/i;

const emailPattern = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}/g;
const waPattern = /(?:wa\.me\/|api\.whatsapp\.com\/send\?phone=)(\+?\d{8,15})/i;
const phonePattern = /(?:\+|\b)\d[\d\s().-]{7,18}\d\b/g;

type SerperItem = { title?: string; link?: string; snippet?: string };

/** Convierte un resultado orgánico en candidato. Pura: la usa el self-check. */
export function candidateFromResult(item: SerperItem, location: string): PersonCandidate | null {
  const title = (item.title ?? "").trim();
  const snippet = (item.snippet ?? "").trim();
  const link = (item.link ?? "").trim();
  if (!title || !link) return null;
  const text = `${title} ${snippet}`;

  const email = (text.match(emailPattern) ?? []).find(isValidEmail) ?? "";
  const waRaw = `${link} ${snippet}`.match(waPattern)?.[1];
  const whatsapp = waRaw ? normalizePhone(waRaw.startsWith("+") ? waRaw : `+${waRaw}`) : "";
  const phone = (text.match(phonePattern) ?? [])
    .filter((value) => !/^\d{4}[-./]\d{2}[-./]\d{2}$/.test(value.trim())) // fechas
    .map(normalizePhone)
    .find(Boolean) ?? "";

  const network = socialNetworkOf(link);
  const socialProfiles: Partial<Record<SocialNetwork, string>> = network ? { [network]: link } : {};
  const parts = title.split(/\s[-|–—·]\s/).map((part) => part.trim()).filter(Boolean);
  const name = (parts[0] ?? title).replace(/\s*\(@?[\w.]+\)\s*$/, "").slice(0, 120);
  const role = (parts.length > 1 ? parts[1] : "").replace(/\b(linkedin|instagram|facebook)\b/gi, "").trim().slice(0, 120);
  let host = "";
  try { host = new URL(link).hostname; } catch { return null; }

  return {
    name,
    role,
    location,
    phone,
    whatsapp,
    email,
    website: network || directoryHosts.test(host) ? "" : link,
    socialProfiles,
    source: "serper",
    sourceUrl: link,
    snippet: snippet.slice(0, 500),
    isBusiness: businessPattern.test(title) || directoryHosts.test(host),
  };
}

export async function searchSerper(queries: string[], opts: { location: string; signal?: AbortSignal; perQuery?: number }): Promise<PersonCandidate[]> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) throw new Error("SERPER_API_KEY is not configured on the server.");
  const { gl, hl } = serperLocale(opts.location);
  const num = Math.min(Math.max(opts.perQuery ?? 10, 1), 10);
  const cleanQueries = [...new Set(queries.map((query) => query.trim().slice(0, 300)).filter(Boolean))].slice(0, 6);

  const perQuery = await mapLimit(cleanQueries, CONCURRENCY, async (q) => {
    if (opts.signal?.aborted) return [];
    try {
      const response = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ q, gl, hl, num }),
        cache: "no-store",
        signal: withTimeout(SERPER_TIMEOUT_MS, opts.signal),
      });
      // Nunca incluir headers ni la key en el log.
      if (!response.ok) { console.error("Serper query failed", response.status); return []; }
      const payload = await response.json() as { organic?: SerperItem[] };
      return (payload.organic ?? []).map((item) => candidateFromResult(item, opts.location)).filter((item): item is PersonCandidate => item !== null);
    } catch (error) {
      if (opts.signal?.aborted) return [];
      console.error("Serper query error", error instanceof Error ? error.name : "unknown");
      return [];
    }
  });

  const seen = new Set<string>();
  return perQuery.flat().filter((candidate) => !seen.has(candidate.sourceUrl) && Boolean(seen.add(candidate.sourceUrl)));
}
