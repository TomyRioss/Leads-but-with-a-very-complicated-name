import type { PeopleSearchPlan, PersonCandidate } from "@/lib/people";
import { extractContacts, normalizePhone } from "@/lib/server/contact-scrape";

// Facebook vía actor oficial de Apify (datos públicos, sin sesión) + runApifyActor compartido. Instagram vive en ./instagram.
// Costo acotado: ≤2 grupos × 15 posts por búsqueda.

type ApifyItem = Record<string, unknown>;
export type MetaSearchOptions = { signal?: AbortSignal; limit?: number; timeoutMs?: number };

const facebookGroupsActor = "apify~facebook-groups-scraper";
const defaultTimeoutMs = 120_000;
const maxGroups = 2;
const postsPerGroup = 15;
export const businessPattern = /\b(s\.?r\.?l|s\.?a\.?s?|ltda|inc|llc|empresa|compa[nñ][ií]a|corporaci[oó]n|holding|group|grupo|franquicia|sucursal(es)?)\b/i;

const text = (value: unknown, max = 1000) => (typeof value === "string" ? value.trim().slice(0, max) : "");

/** Ejecuta un actor de Apify y devuelve sus items; [] ante cualquier error (se loguea sin el token). */
export async function runApifyActor(actor: string, input: Record<string, unknown>, opts: MetaSearchOptions = {}): Promise<ApifyItem[]> {
  const token = process.env.APIFY_TOKEN;
  if (!token) {
    console.warn(`[people/meta] APIFY_TOKEN missing; skipping ${actor}`);
    return [];
  }
  const timeoutMs = opts.timeoutMs ?? defaultTimeoutMs;
  const signal = opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  try {
    const response = await fetch(
      `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?timeout=${Math.ceil(timeoutMs / 1000)}&format=json&clean=true`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal,
        cache: "no-store",
      },
    );
    if (!response.ok) {
      console.warn(`[people/meta] ${actor} responded ${response.status}: ${(await response.text()).slice(0, 200)}`);
      return [];
    }
    const data: unknown = await response.json();
    return Array.isArray(data) ? data.filter((item): item is ApifyItem => Boolean(item) && typeof item === "object" && !("error" in item)) : [];
  } catch (error) {
    console.warn(`[people/meta] ${actor} failed: ${error instanceof Error ? error.message.slice(0, 200) : "unknown"}`);
    return [];
  }
}

/** Email, teléfono y WhatsApp escritos como texto libre (bio, post). */
export function contactsFromText(value: string) {
  const found = extractContacts(value, "https://example.invalid/");
  const wa = value.match(/(?:wa\.me\/|api\.whatsapp\.com\/send\/?\?phone=)\+?(\d{8,15})/i);
  const phoneMatch = [...value.matchAll(/(?:\+|\b)\d[\d\s().-]{7,18}\d\b/g)]
    .map((match) => normalizePhone(match[0]))
    .find(Boolean) ?? "";
  const mentionsWhatsapp = /whats?app|\bwsp\b|\bwpp\b/i.test(value);
  const whatsapp = wa ? normalizePhone(`+${wa[1]}`) : mentionsWhatsapp ? phoneMatch : "";
  return { email: found.email, phone: found.phone || phoneMatch, whatsapp };
}

/** Mapea un post de facebook-groups-scraper; solo si el texto trae algún contacto. */
export function mapFacebookPost(item: ApifyItem, plan: Pick<PeopleSearchPlan, "role" | "location">): PersonCandidate | null {
  const body = text(item.text, 2000);
  const contacts = contactsFromText(body);
  if (!contacts.email && !contacts.phone && !contacts.whatsapp) return null;
  const user = item.user && typeof item.user === "object" ? (item.user as { name?: unknown; id?: unknown; profileUrl?: unknown }) : {};
  const name = text(user.name, 120);
  if (!name) return null;
  const postUrl = text(item.url) || text(item.facebookUrl);
  const profileUrl = text(user.profileUrl) || (typeof user.id === "string" && /^\d+$/.test(user.id) ? `https://www.facebook.com/profile.php?id=${user.id}` : "");
  return {
    name,
    role: plan.role,
    location: plan.location,
    phone: contacts.phone,
    whatsapp: contacts.whatsapp,
    email: contacts.email,
    website: "",
    socialProfiles: profileUrl ? { facebook: profileUrl } : {},
    source: "facebook",
    sourceUrl: postUrl,
    snippet: [text(item.groupTitle, 120), body.slice(0, 600)].filter(Boolean).join(" · "),
    isBusiness: businessPattern.test(name),
  };
}

/** El actor exige URLs de grupos: se resuelven con una búsqueda acotada en Serper (site:facebook.com/groups). */
export async function resolveFacebookGroups(queries: string[], signal?: AbortSignal): Promise<string[]> {
  const key = process.env.SERPER_API_KEY;
  if (!key || !queries.length) return [];
  const urls = new Set<string>();
  for (const query of queries.slice(0, maxGroups)) {
    try {
      const timeout = AbortSignal.timeout(10_000);
      const response = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: { "X-API-KEY": key, "Content-Type": "application/json" },
        body: JSON.stringify({ q: `site:facebook.com/groups ${query}`, num: 5 }),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        cache: "no-store",
      });
      if (!response.ok) continue;
      const data = (await response.json()) as { organic?: { link?: unknown }[] };
      for (const result of data.organic ?? []) {
        const match = text(result.link).match(/^https:\/\/(?:www\.|m\.)?facebook\.com\/groups\/([A-Za-z0-9._-]+)/);
        if (match) urls.add(`https://www.facebook.com/groups/${match[1]}`);
      }
    } catch (error) {
      console.warn(`[people/meta] group lookup failed: ${error instanceof Error ? error.message.slice(0, 120) : "unknown"}`);
    }
    if (urls.size >= maxGroups) break;
  }
  return [...urls].slice(0, maxGroups);
}

/** facebook-groups-scraper sobre grupos públicos del rubro: posts con teléfono/WhatsApp/email, autor como nombre. */
export async function searchFacebookGroups(plan: PeopleSearchPlan, opts: MetaSearchOptions = {}): Promise<PersonCandidate[]> {
  const groups = await resolveFacebookGroups(plan.facebookGroupQueries.map((query) => query.trim()).filter(Boolean), opts.signal);
  if (!groups.length || opts.signal?.aborted) return [];
  const posts = await runApifyActor(facebookGroupsActor, {
    startUrls: groups.map((url) => ({ url })),
    resultsLimit: postsPerGroup,
    viewOption: "CHRONOLOGICAL",
  }, opts);
  const seen = new Set<string>();
  const candidates: PersonCandidate[] = [];
  for (const item of posts) {
    const candidate = mapFacebookPost(item, plan);
    const key = candidate && (candidate.whatsapp || candidate.phone || candidate.email);
    if (candidate && key && !seen.has(key)) {
      seen.add(key);
      candidates.push(candidate);
    }
  }
  return candidates.slice(0, opts.limit ?? 25);
}
