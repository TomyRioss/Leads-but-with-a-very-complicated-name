import { completenessOf, hasContact, type PersonCandidate } from "@/lib/people";
import { isValidEmail, normalizePhone, scrapeWebsite, socialNetworkOf } from "@/lib/server/contact-scrape";
import type { SocialNetwork } from "@/lib/types";
import { cleanWebsiteUrl } from "@/lib/url-display";

const allNetworks: SocialNetwork[] = ["facebook", "instagram", "youtube", "linkedin"];
const scrapeTimeoutMs = 12_000;

// Marketplaces, big directories and networks that block scraping: their pages aren't the person's own site.
const notPersonalHosts = [
  "facebook.com", "fb.com", "instagram.com", "linkedin.com", "youtube.com", "tiktok.com", "twitter.com", "x.com",
  "github.com", "google.com", "goo.gl", "wikipedia.org", "mercadolibre.com", "mercadolibre.com.ar", "olx.com",
  "olx.com.ar", "yelp.com", "paginasamarillas.com", "paginasamarillas.com.ar", "guiaoleo.com.ar", "doctoralia.com",
  "doctoralia.com.ar", "workana.com", "fiverr.com", "upwork.com", "freelancer.com", "zonaprop.com.ar", "argenprop.com",
  "computrabajo.com", "bumeran.com", "indeed.com", "glassdoor.com", "tripadvisor.com", "linktr.ee", "wa.me", "whatsapp.com",
];

const hostOf = (rawUrl: string) => {
  try {
    const url = new URL(rawUrl.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.hostname.toLowerCase().replace(/^www\./, "") : "";
  } catch {
    return "";
  }
};

export function isPersonalPage(rawUrl: string) {
  const host = hostOf(rawUrl);
  return Boolean(host) && !notPersonalHosts.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}

const digits = (value: string) => value.replace(/\D/g, "");

/**
 * wa.me link for a mobile number. Accepts an existing wa.me/api.whatsapp link or an international mobile.
 * ponytail: only Argentina (+54 9) is recognised as mobile from the number alone; other countries need an explicit WhatsApp link.
 */
export function whatsappFrom(value: string) {
  const raw = value.trim();
  const fromLink = raw.match(/(?:wa\.me\/|api\.whatsapp\.com\/send\?phone=|whatsapp\.com\/send\?phone=)\+?(\d{8,15})/i)?.[1];
  if (fromLink) return `https://wa.me/${fromLink}`;
  const phone = normalizePhone(raw);
  if (!phone.startsWith("+")) return "";
  const number = digits(phone);
  return /^549\d{10}$/.test(number) ? `https://wa.me/${number}` : "";
}

export function normalizeUrlKey(rawUrl: string) {
  try {
    const url = new URL(rawUrl.trim());
    return `${url.hostname.toLowerCase().replace(/^www\./, "")}${url.pathname.replace(/\/+$/, "").toLowerCase()}`;
  } catch {
    return "";
  }
}

/** Keys that identify the same person across sources. */
function identityKeys(person: PersonCandidate) {
  return [
    person.email && `e:${person.email.trim().toLowerCase()}`,
    person.phone && digits(person.phone).length >= 8 && `p:${digits(person.phone).slice(-10)}`,
    person.whatsapp && digits(person.whatsapp).length >= 8 && `p:${digits(person.whatsapp).slice(-10)}`,
    person.sourceUrl && `u:${normalizeUrlKey(person.sourceUrl)}`,
    person.website && isPersonalPage(person.website) && `u:${normalizeUrlKey(person.website)}`,
  ].filter((key): key is string => Boolean(key) && key !== "u:");
}

/** First occurrence wins; later duplicates only fill fields the kept one lacks. */
export function dedupePeople(people: PersonCandidate[]) {
  const kept: PersonCandidate[] = [];
  const byKey = new Map<string, PersonCandidate>();
  for (const person of people) {
    const keys = identityKeys(person);
    const existing = keys.map((key) => byKey.get(key)).find(Boolean);
    if (existing) {
      existing.email ||= person.email;
      existing.phone ||= person.phone;
      existing.whatsapp ||= person.whatsapp;
      existing.website ||= person.website;
      existing.socialProfiles = { ...person.socialProfiles, ...existing.socialProfiles };
    } else {
      kept.push(person);
    }
    const target = existing ?? person;
    for (const key of [...keys, ...identityKeys(target)]) byKey.set(key, target);
  }
  return kept;
}

/** Cleans contact fields, derives WhatsApp and normalises profile URLs. Pure. */
export function normalizeCandidate(person: PersonCandidate): PersonCandidate {
  const email = isValidEmail(person.email.trim().toLowerCase()) ? person.email.trim().toLowerCase() : "";
  const phone = normalizePhone(person.phone);
  const whatsapp = whatsappFrom(person.whatsapp) || whatsappFrom(phone);
  const socialProfiles: PersonCandidate["socialProfiles"] = {};
  for (const [network, url] of Object.entries(person.socialProfiles ?? {})) {
    if (url && socialNetworkOf(url) === network) socialProfiles[network as SocialNetwork] = url.trim();
  }
  return { ...person, email, phone, whatsapp, socialProfiles };
}

// Longest prefix first so +598 wins over +5…; ponytail: Latin America + main markets, extend when needed.
const dialCodes: [string, string][] = [
  ["598", "uy"], ["595", "py"], ["593", "ec"], ["591", "bo"], ["507", "pa"], ["506", "cr"], ["503", "sv"], ["502", "gt"], ["351", "pt"],
  ["54", "ar"], ["56", "cl"], ["57", "co"], ["58", "ve"], ["51", "pe"], ["52", "mx"], ["55", "br"], ["53", "cu"], ["34", "es"], ["44", "gb"], ["1", "us"],
];
const countryNames: [RegExp, string][] = [
  [/argentina/i, "ar"], [/chile/i, "cl"], [/m[eé]xico/i, "mx"], [/uruguay/i, "uy"], [/colombia/i, "co"], [/per[uú]\b/i, "pe"],
  [/espa[ñn]a|spain/i, "es"], [/venezuela/i, "ve"], [/brasil|brazil/i, "br"], [/paraguay/i, "py"], [/ecuador/i, "ec"], [/bolivia/i, "bo"],
  [/united states|\busa\b|estados unidos/i, "us"], [/united kingdom|reino unido|england/i, "gb"], [/portugal/i, "pt"],
];

/** Country of a candidate from an international phone/WhatsApp or a country name in its location; "" if unknown. Pure. */
export function candidateCountry(person: Pick<PersonCandidate, "phone" | "whatsapp" | "location">): string {
  const intl = [person.whatsapp, person.phone].map((value) => value.trim()).find((value) => value.startsWith("+"));
  if (intl) {
    const number = digits(intl);
    const hit = dialCodes.find(([code]) => number.startsWith(code));
    if (hit) return hit[1];
  }
  return countryNames.find(([pattern]) => pattern.test(person.location))?.[1] ?? "";
}

/**
 * Platform searches (Instagram, TikTok, YouTube…) are worldwide: drop people whose known country isn't the requested one.
 * Unknown country is kept. `expected` is an ISO-2 code ("" = no location requested). Pure.
 */
export function fitsCountry(person: Pick<PersonCandidate, "phone" | "whatsapp" | "location">, expected: string) {
  if (!expected) return true;
  const country = candidateCountry(person);
  return !country || country === expected;
}

/** Normalise → drop businesses/no contact → dedupe → most complete first. Pure (no network). */
export function filterPeople(people: PersonCandidate[]) {
  const usable = people.map(normalizeCandidate).filter((person) => !person.isBusiness && hasContact(person));
  return dedupePeople(usable)
    .map((person, index) => ({ person, index, score: completenessOf(person, false) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ person }) => person);
}

function withTimeout<T>(promise: Promise<T>, ms: number, signal?: AbortSignal): Promise<T | null> {
  return new Promise((resolve) => {
    const done = (value: T | null) => { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); resolve(value); };
    const onAbort = () => done(null);
    const timer = setTimeout(() => done(null), ms);
    signal?.addEventListener("abort", onAbort, { once: true });
    promise.then(done, () => done(null));
  });
}

async function scrapeInto(person: PersonCandidate, signal?: AbortSignal) {
  const page = [person.website, person.sourceUrl].find((url) => url && isPersonalPage(url));
  if (!page || (person.email && (person.phone || person.whatsapp))) return person;
  const scraped = await withTimeout(scrapeWebsite(page, allNetworks), scrapeTimeoutMs, signal);
  if (!scraped) return person;
  const socialProfiles = { ...person.socialProfiles };
  for (const [network, found] of Object.entries(scraped.socials)) {
    socialProfiles[network as SocialNetwork] ||= found?.value;
  }
  return {
    ...person,
    website: cleanWebsiteUrl(person.website || page) || person.website || page,
    email: person.email || scraped.email?.value || "",
    phone: person.phone || scraped.phone?.value || "",
    whatsapp: person.whatsapp || scraped.whatsapp?.value || "",
    socialProfiles,
  };
}

export async function enrichCandidates(candidates: PersonCandidate[], opts: { concurrency?: number; signal?: AbortSignal } = {}) {
  const concurrency = Math.max(1, Math.min(5, opts.concurrency ?? 5));
  const pool = candidates.filter((person) => !person.isBusiness);
  const enriched = [...pool];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, pool.length) }, async () => {
    while (next < pool.length && !opts.signal?.aborted) {
      const index = next++;
      enriched[index] = await scrapeInto(pool[index], opts.signal);
    }
  }));
  return filterPeople(enriched);
}
