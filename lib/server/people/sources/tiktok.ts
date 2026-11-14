import type { PeopleSearchPlan, PersonCandidate } from "@/lib/people";
import type { SocialNetwork } from "@/lib/types";
import { isValidEmail, normalizePhone, socialNetworkOf } from "@/lib/server/contact-scrape";
import { businessPattern, runApifyActor } from "./meta";

// TikTok vía deepmine/tiktok-email-scraper: cobra solo creadores con email público (~USD 0,00179 c/u).

type ApifyItem = Record<string, unknown>;

const tiktokActor = "deepmine~tiktok-email-scraper";
const maxKeywords = 4;
const maxCreators = 50;

const text = (value: unknown, max = 1000) => (typeof value === "string" ? value.trim().slice(0, max) : "");
/** Acepta string o array (de strings); devuelve la lista limpia. */
const list = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [value]).map((entry) => text(entry)).filter(Boolean);

const handleBase: Partial<Record<SocialNetwork, string>> = {
  instagram: "https://www.instagram.com/",
  youtube: "https://www.youtube.com/@",
  facebook: "https://www.facebook.com/",
};

/** Handle o URL de una red → URL https completa de perfil, o "" si no es válida. */
export function socialUrl(value: string, network: SocialNetwork): string {
  const raw = value.trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw) || /^(www\.|m\.)?[a-z0-9-]+\.[a-z]{2,}\//i.test(raw)) {
    const url = (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).replace(/^http:\/\//i, "https://");
    return socialNetworkOf(url) === network ? url : "";
  }
  const base = handleBase[network];
  const handle = raw.replace(/^@/, "");
  return base && /^[A-Za-z0-9._-]{1,100}$/.test(handle) ? `${base}${handle}` : "";
}

/** Mapea un creador del actor; null si no tiene usuario o ningún contacto (email/teléfono/WhatsApp). */
export function mapTiktokCreator(item: ApifyItem, plan: Pick<PeopleSearchPlan, "role" | "location">): PersonCandidate | null {
  const username = text(item.username, 60).replace(/^@/, "");
  if (!username) return null;
  const email = [...list(item.email), ...list(item.emails)].map((value) => value.toLowerCase()).find(isValidEmail) ?? "";
  const phone = list(item.phones).map(normalizePhone).find(Boolean) ?? "";
  const whatsappRaw = list(item.whatsapp)[0] ?? "";
  const waDigits = whatsappRaw.match(/(?:wa\.me\/|phone=)\+?(\d{8,15})/i)?.[1];
  const whatsapp = waDigits ? normalizePhone(`+${waDigits}`) : normalizePhone(whatsappRaw);
  if (!email && !phone && !whatsapp) return null;

  const profileUrl = text(item.profileUrl) || `https://www.tiktok.com/@${username}`;
  const name = text(item.nickname, 120) || username;
  const bioLink = text(item.bioLink);
  const bioUrl = /^https?:\/\//i.test(bioLink) ? bioLink : bioLink ? `https://${bioLink}` : "";
  const website = bioUrl && !socialNetworkOf(bioUrl) && !/wa\.me|whatsapp\.com|tiktok\.com|(?:x|twitter)\.com|t\.me/i.test(bioUrl) ? bioUrl : "";
  const socialProfiles: Partial<Record<SocialNetwork, string>> = {};
  for (const network of ["instagram", "youtube", "facebook", "linkedin"] as const) {
    const url = list(item[network]).map((value) => socialUrl(value, network)).find(Boolean)
      ?? (bioUrl && socialNetworkOf(bioUrl) === network ? bioUrl : "");
    if (url) socialProfiles[network] = url;
  }
  const bio = text(item.bio, 600) || text(item.bioSnippet, 600);
  const followers = typeof item.followers === "number" ? `${item.followers} followers` : "";
  return {
    name,
    role: text(item.businessCategory, 120) || plan.role,
    location: plan.location,
    phone,
    whatsapp,
    email,
    website,
    socialProfiles,
    source: "tiktok",
    sourceUrl: profileUrl,
    snippet: [bio, followers].filter(Boolean).join(" · ").slice(0, 800),
    isBusiness: businessPattern.test(name) || businessPattern.test(username),
  };
}

/** Keywords del plan (o el rol) + ciudad, porque la búsqueda de TikTok no filtra por zona. */
export function tiktokKeywords(plan: Pick<PeopleSearchPlan, "keywords" | "role" | "location">): string[] {
  const city = plan.location.split(",")[0]?.trim() ?? "";
  const base = plan.keywords.map((keyword) => keyword.trim()).filter(Boolean);
  const keywords = (base.length ? base : [plan.role.trim()]).filter(Boolean).slice(0, maxKeywords);
  return [...new Set(keywords.map((keyword) => (city && !keyword.toLowerCase().includes(city.toLowerCase()) ? `${keyword} ${city}` : keyword)))];
}

export async function searchTiktok(plan: PeopleSearchPlan, opts: { signal?: AbortSignal; limit?: number } = {}): Promise<PersonCandidate[]> {
  const keywords = tiktokKeywords(plan);
  if (!keywords.length || opts.signal?.aborted) return [];
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), maxCreators);
  const items = await runApifyActor(tiktokActor, {
    keywords,
    maxCreators: Math.min(limit * 2, maxCreators),
    onlyWithEmail: true,
  }, opts);
  const seen = new Set<string>();
  const candidates: PersonCandidate[] = [];
  for (const item of items) {
    const candidate = mapTiktokCreator(item, plan);
    const key = text(item.username).toLowerCase();
    if (candidate && key && !seen.has(key)) {
      seen.add(key);
      candidates.push(candidate);
    }
  }
  return candidates.slice(0, limit);
}
