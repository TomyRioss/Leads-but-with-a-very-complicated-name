import type { PeopleSearchPlan, PersonCandidate } from "@/lib/people";
import type { SocialNetwork } from "@/lib/types";
import { isValidEmail, socialNetworkOf } from "@/lib/server/contact-scrape";
import { businessPattern, contactsFromText, runApifyActor } from "./meta";

// Marketplaces de freelancers/profesionales vía Apify (datos públicos, sin login).
// Fiverr $1.10/1k (solo vendedores con contacto público), Behance $2/1k + $0.005/run (sin email, trae redes y portfolio),
// Thumbtack $0.70/1k (pros de EE.UU.; el actor no devuelve teléfono, email ni web).

type ApifyItem = Record<string, unknown>;
type PlanContext = Pick<PeopleSearchPlan, "role" | "location">;
export type MarketplaceSearchOptions = { signal?: AbortSignal; limit?: number };

const fiverrActor = "apivault_labs~fiverr-seller-scraper";
const behanceActor = "memo23~behance-scraper";
const defaultLimit = 20;
const maxLimit = 50;
const maxKeywords = 3;
// Redes/portales que no son el sitio propio del profesional (no sirven para scrapear contacto).
const nonPortfolioHost = /(^|\.)(behance\.net|adobe\.com|dribbble\.com|artstation\.com|twitter\.com|x\.com|pinterest\.[a-z.]+|tiktok\.com|fiverr\.com|upwork\.com|thumbtack\.com|wa\.me|whatsapp\.com|t\.me)$/i;
const behanceNetworks: SocialNetwork[] = ["instagram", "linkedin", "facebook", "youtube"];

const text = (value: unknown, max = 1000) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const limitOf = (opts: MarketplaceSearchOptions) => Math.min(Math.max(Math.floor(opts.limit ?? defaultLimit), 1), maxLimit);
const keywordsOf = (plan: PeopleSearchPlan) =>
  [...new Set((plan.keywords?.length ? plan.keywords : [plan.role]).map((keyword) => keyword?.trim()).filter(Boolean))].slice(0, maxKeywords);

/** Strings o {url} → URLs http(s) únicas. */
function urlsOf(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [value];
  const urls = list.map((entry) => (typeof entry === "string" ? entry.trim() : entry && typeof entry === "object" ? text((entry as { url?: unknown }).url) : ""));
  return [...new Set(urls.filter((url) => /^https?:\/\//i.test(url)))];
}

const toHttps = (url: string) => url.replace(/^http:\/\//i, "https://");

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

/** Primer link que no es red social ni portal: el sitio/portfolio propio. */
const ownSiteOf = (urls: string[]) => urls.find((url) => !socialNetworkOf(url) && hostOf(url) && !nonPortfolioHost.test(hostOf(url))) ?? "";

function socialProfilesFrom(urls: string[]): Partial<Record<SocialNetwork, string>> {
  const profiles: Partial<Record<SocialNetwork, string>> = {};
  for (const url of urls) {
    const network = socialNetworkOf(url);
    if (network && !profiles[network]) profiles[network] = toHttps(url);
  }
  return profiles;
}

const hasAny = (profiles: Partial<Record<SocialNetwork, string>>) => Object.values(profiles).some(Boolean);

/** Vendedor de fiverr-seller-scraper → candidato; null si no publica email, web, red ni teléfono. */
export function mapFiverrSeller(item: ApifyItem, plan: PlanContext): PersonCandidate | null {
  if (item.success === false) return null;
  const username = text(item.username, 80);
  const sourceUrl = text(item.profileUrl) || text(item.inputUrl) || (username ? `https://www.fiverr.com/${username}` : "");
  if (!sourceUrl) return null;
  const signals = (item.contactSignals && typeof item.contactSignals === "object" ? item.contactSignals : {}) as Record<string, unknown>;
  const bio = text(item.bio, 1500);
  const fromBio = contactsFromText(bio);
  const emails = (Array.isArray(signals.emails) ? signals.emails : []).map((value) => text(value, 254).toLowerCase());
  const email = emails.find(isValidEmail) ?? fromBio.email;
  const websites = urlsOf(signals.websites);
  const website = ownSiteOf(websites);
  const socialProfiles = socialProfilesFrom([...websites, ...urlsOf(signals.socials)]);
  if (!email && !website && !hasAny(socialProfiles) && !fromBio.phone && !fromBio.whatsapp) return null;
  const name = text(item.displayName, 120) || username;
  const rating = typeof item.ratingValue === "number" ? `${item.ratingValue}★ (${typeof item.reviewsCountNum === "number" ? item.reviewsCountNum : 0} reviews)` : "";
  return {
    name,
    role: plan.role,
    location: text(item.location, 120) || plan.location,
    phone: fromBio.phone,
    whatsapp: fromBio.whatsapp,
    email,
    website,
    socialProfiles,
    source: "fiverr",
    sourceUrl,
    snippet: [text(item.tagline, 200), text(item.primaryNiche, 120), rating, bio].filter(Boolean).join(" · ").slice(0, 800),
    isBusiness: businessPattern.test(name),
  };
}

/** Diseñador de behance-scraper → candidato sin email (lo busca el enriquecimiento en su web); null sin web ni redes. */
export function mapBehanceUser(item: ApifyItem, plan: PlanContext): PersonCandidate | null {
  const username = text(item.username, 80);
  const sourceUrl = text(item.url) || (username ? `https://www.behance.net/${username}` : "");
  if (!sourceUrl) return null;
  const perNetwork = behanceNetworks.flatMap((network) => urlsOf(item[network]));
  const socialProfiles = socialProfilesFrom([...perNetwork, ...urlsOf(item.socialLinks)]);
  const website = ownSiteOf(urlsOf(item.otherLinks));
  if (!website && !hasAny(socialProfiles)) return null;
  const name = text(item.name, 120) || username;
  const company = text(item.company, 120);
  const location = text(item.location, 120);
  const country = text(item.country, 80);
  return {
    name,
    role: plan.role,
    location: location && country && !location.toLowerCase().includes(country.toLowerCase()) ? `${location}, ${country}` : location || country || plan.location,
    phone: "",
    whatsapp: "",
    email: "",
    website,
    socialProfiles,
    source: "behance",
    sourceUrl,
    snippet: [company, typeof item.followers === "number" ? `${item.followers} followers` : "", item.availableForHire === true ? "available for hire" : ""].filter(Boolean).join(" · ").slice(0, 800),
    isBusiness: businessPattern.test(name) || businessPattern.test(company),
  };
}

function mapAll(items: ApifyItem[], plan: PlanContext, mapper: (item: ApifyItem, plan: PlanContext) => PersonCandidate | null, limit: number) {
  const seen = new Set<string>();
  const people: PersonCandidate[] = [];
  for (const item of items) {
    const person = mapper(item, plan);
    if (!person || seen.has(person.sourceUrl)) continue;
    seen.add(person.sourceUrl);
    people.push(person);
    if (people.length >= limit) break;
  }
  return people;
}

/** Fiverr: búsqueda por keywords, solo vendedores con contacto público (requireContact). */
export async function searchFiverr(plan: PeopleSearchPlan, opts: MarketplaceSearchOptions = {}): Promise<PersonCandidate[]> {
  const searchQueries = keywordsOf(plan);
  if (!searchQueries.length) return [];
  const limit = limitOf(opts);
  const items = await runApifyActor(fiverrActor, {
    mode: "search",
    searchQueries,
    requireContact: true,
    maxResults: limit,
    extractGigs: false,
    extractGigPrices: false,
    extractReviewsText: false,
    extractBio: true,
    extractLanguages: false,
    extractSkills: false,
    scrapeGigs: false,
    generateComparison: false,
  }, { signal: opts.signal, limit });
  return mapAll(items, plan, mapFiverrSeller, limit);
}

/** País (o ciudad/región) para el filtro de Behance: última parte separada por coma de plan.location. */
export function behanceCountryOf(location: string): string {
  return location.split(",").map((part) => part.trim()).filter(Boolean).at(-1) ?? "";
}

/** Behance: diseñadores por keyword, filtrados por país si la búsqueda tiene ubicación. */
export async function searchBehance(plan: PeopleSearchPlan, opts: MarketplaceSearchOptions = {}): Promise<PersonCandidate[]> {
  const searchKeywords = keywordsOf(plan);
  if (!searchKeywords.length) return [];
  const limit = limitOf(opts);
  const country = behanceCountryOf(plan.location ?? "");
  const items = await runApifyActor(behanceActor, {
    searchKeywords,
    ...(country ? { countries: [country] } : {}),
    maxResultsPerKeyword: 100, // mínimo del actor: 20; con filtro de país se descartan muchos, el costo lo acota maxItems.
    maxItems: limit,
  }, { signal: opts.signal, limit });
  return mapAll(items, plan, mapBehanceUser, limit);
}

