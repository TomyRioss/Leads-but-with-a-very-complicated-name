import type { PeopleSearchPlan, PersonCandidate } from "@/lib/people";
import type { SocialNetwork } from "@/lib/types";
import { isValidEmail, normalizePhone, socialNetworkOf } from "@/lib/server/contact-scrape";
import { businessPattern, contactsFromText, runApifyActor } from "@/lib/server/people/sources/meta";

// Instagram vía instagram-data-api/instagram-email-phone-scraper: búsqueda por keyword + contacto en una sola corrida.
// Costo: USD 0,00033 por perfil revisado + 0,0022 por contacto encontrado → se acota maxProfilesPerKeyword.

type ApifyItem = Record<string, unknown>;
export type InstagramSearchOptions = { signal?: AbortSignal; limit?: number; timeoutMs?: number };

const instagramContactActor = "instagram-data-api~instagram-email-phone-scraper";
const maxKeywords = 3;
const defaultTimeoutMs = 180_000;

const text = (value: unknown, max = 1000) => (typeof value === "string" ? value.trim().slice(0, max) : typeof value === "number" ? String(value) : "");
const list = (value: unknown): string[] => (Array.isArray(value) ? value : [value]).map((entry) => text(entry)).filter(Boolean);
const urlOf = (entry: unknown) => (entry && typeof entry === "object" ? text((entry as { url?: unknown }).url) : text(entry));
const stripAccents = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function linksOf(item: ApifyItem): string[] {
  const links = [text(item.externalUrl), ...(Array.isArray(item.bioLinks) ? item.bioLinks.map(urlOf) : [])];
  return [...new Set(links.filter((url) => /^https?:\/\//i.test(url)))];
}

function firstEmail(item: ApifyItem): string {
  return [...list(item.email), ...list(item.emails), ...list(item.publicEmail)]
    .map((value) => value.toLowerCase())
    .find(isValidEmail) ?? "";
}

function firstPhone(item: ApifyItem): string {
  const code = text(item.publicPhoneCountryCode).replace(/\D/g, "");
  const publicPhone = text(item.publicPhone);
  const withCode = publicPhone && code && !publicPhone.startsWith("+") && !publicPhone.replace(/\D/g, "").startsWith(code) ? `+${code}${publicPhone}` : publicPhone;
  return [...list(item.phone), ...list(item.phones), withCode].map(normalizePhone).find(Boolean) ?? "";
}

function whatsappOf(item: ApifyItem, links: string[]): string {
  const raw = text(item.whatsapp);
  const fromField = raw.match(/(?:wa\.me\/|phone=)\+?(\d{8,15})/i)?.[1];
  if (fromField) return normalizePhone(`+${fromField}`);
  if (raw && !/^https?:/i.test(raw)) {
    const phone = normalizePhone(raw);
    if (phone) return phone;
  }
  const link = links.map((url) => url.match(/(?:wa\.me\/|api\.whatsapp\.com\/send\/?\?phone=)\+?(\d{8,15})/i)?.[1]).find(Boolean);
  return link ? normalizePhone(`+${link}`) : "";
}

/** Mapea un item del actor a candidato. Pura: la usa el self-check. Filas de diagnóstico (sin username) y privados → null. */
export function mapInstagramContact(item: ApifyItem, plan: Pick<PeopleSearchPlan, "role" | "location">): PersonCandidate | null {
  const username = text(item.username, 60);
  if (!username || item.isPrivate === true) return null;
  const profileUrl = text(item.profileUrl) || `https://www.instagram.com/${username}`;
  const name = text(item.fullName, 120) || username;
  const biography = text(item.biography, 600);
  const fromBio = contactsFromText(biography);
  const links = linksOf(item);
  const socialProfiles: Partial<Record<SocialNetwork, string>> = {};
  for (const url of [text(item.facebookUrl), ...links]) {
    const network = url && socialNetworkOf(url);
    if (network && !socialProfiles[network]) socialProfiles[network] = url;
  }
  socialProfiles.instagram = profileUrl;
  const followers = typeof item.followers === "number" ? `${item.followers} followers` : "";
  return {
    name,
    role: text(item.category, 120) || plan.role,
    location: text(item.city, 120) || plan.location,
    phone: firstPhone(item) || fromBio.phone,
    whatsapp: whatsappOf(item, links) || fromBio.whatsapp,
    email: firstEmail(item) || fromBio.email,
    website: links.find((url) => !socialNetworkOf(url) && !/wa\.me|whatsapp\.com/i.test(url)) ?? "",
    socialProfiles,
    source: "instagram",
    sourceUrl: profileUrl,
    snippet: [biography, followers].filter(Boolean).join(" · ").slice(0, 800),
    isBusiness: businessPattern.test(name) || businessPattern.test(username),
  };
}

/** Keywords del plan (o hashtags/rol legado) con la ciudad agregada: el parámetro `city` del actor no filtra bien. */
export function instagramKeywords(plan: Pick<PeopleSearchPlan, "keywords" | "instagramQueries" | "role" | "location">): string[] {
  const base = [plan.keywords, plan.instagramQueries, [plan.role]]
    .map((group) => (group ?? []).map((value) => value.replace(/^#/, "").trim()).filter(Boolean))
    .find((group) => group.length) ?? [];
  const city = plan.location.split(",")[0]?.trim() ?? "";
  const seen = new Set<string>();
  const result: string[] = [];
  for (const keyword of base) {
    const phrase = city && !stripAccents(keyword).includes(stripAccents(city)) ? `${keyword} ${city}` : keyword;
    const key = stripAccents(phrase);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(phrase);
    }
    if (result.length >= maxKeywords) break;
  }
  return result;
}

/** Una corrida del actor: perfiles por keyword con contacto público ya extraído. */
export async function searchInstagram(plan: PeopleSearchPlan, opts: InstagramSearchOptions = {}): Promise<PersonCandidate[]> {
  const keywords = instagramKeywords(plan);
  if (!keywords.length || opts.signal?.aborted) return [];
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 50);
  const items = await runApifyActor(instagramContactActor, {
    searchKeywords: keywords,
    onlyWithContact: true,
    maxProfilesPerKeyword: Math.ceil((limit * 2) / keywords.length),
  }, { signal: opts.signal, timeoutMs: opts.timeoutMs ?? defaultTimeoutMs });
  const byUsername = new Map<string, PersonCandidate>();
  for (const item of items) {
    const key = text(item.username).toLowerCase();
    if (!key || byUsername.has(key)) continue;
    const candidate = mapInstagramContact(item, plan);
    if (candidate) byUsername.set(key, candidate);
  }
  return [...byUsername.values()].slice(0, limit);
}
