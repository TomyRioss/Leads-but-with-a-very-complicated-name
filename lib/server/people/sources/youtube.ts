import type { PeopleSearchPlan, PersonCandidate } from "@/lib/people";
import type { SocialNetwork } from "@/lib/types";
import { isValidEmail, normalizePhone, socialNetworkOf } from "@/lib/server/contact-scrape";
import { businessPattern, runApifyActor } from "./meta";
import { serperLocale } from "./serper";

// Canales de YouTube con email vía topapi/youtube-channel-email-scraper.
// Con includeChannelsWithoutEmail:false solo cobra canales con email (USD 0,0009 c/u); maxResults acota el gasto.

type ApifyItem = Record<string, unknown>;

const youtubeActor = "topapi~youtube-channel-email-scraper";
const maxQueries = 3;
const maxPerQuery = 30;
const maxChannelsChecked = 80; // corta la búsqueda por keyword: acota latencia (no cobra canales sin email)
const timeoutMs = 180_000;
// Valores del enum `country` del input schema del actor (verificado).
const actorCountries = new Set("US GB CA AU NZ IE IN PK PH SG MY ID TH VN JP KR TW HK DE AT CH FR BE NL IT ES PT PL CZ RO HU GR SE NO DK FI RU UA TR IL SA AE EG NG KE ZA MA BR MX AR CO CL PE".split(" "));
const actorLanguages = new Set("en es pt fr de it nl pl cs ro hu el sv no da fi ru uk tr ar he hi bn ur id ms th vi ja ko zh tl".split(" "));

const text = (value: unknown, max = 1000) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const isUrl = (value: string) => /^https?:\/\//i.test(value);
const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

/** Código ISO y nombres (en/es) aceptados en el campo `country` del canal para el país buscado. */
export function countryAliases(code: string): Set<string> {
  const aliases = new Set([fold(code)]);
  for (const lang of ["en", "es"]) {
    try {
      const name = new Intl.DisplayNames([lang], { type: "region" }).of(code.toUpperCase());
      if (name) aliases.add(fold(name));
    } catch { /* código inválido */ }
  }
  return aliases;
}

/** true si el canal no declara país o declara el buscado. */
export function matchesCountry(item: ApifyItem, accepted: Set<string>): boolean {
  const declared = fold(text(item.country, 80));
  return !declared || accepted.has(declared);
}

function firstPhone(item: ApifyItem): string {
  const direct = normalizePhone(text(item.phone, 40));
  if (direct) return direct;
  if (!Array.isArray(item.phones)) return "";
  for (const entry of item.phones) {
    const raw = typeof entry === "string" ? entry : entry && typeof entry === "object" ? text((entry as { phone?: unknown }).phone, 40) : "";
    const phone = normalizePhone(raw);
    if (phone) return phone;
  }
  return "";
}

function firstEmail(item: ApifyItem): string {
  const list = [item.email, ...(Array.isArray(item.emails) ? item.emails : [])]
    .map((value) => (typeof value === "string" ? value : value && typeof value === "object" ? text((value as { email?: unknown }).email) : ""))
    .map((value) => value.trim().toLowerCase());
  return list.find(isValidEmail) ?? "";
}

function whatsappOf(url: string): string {
  const digits = url.match(/(?:wa\.me\/|api\.whatsapp\.com\/send\/?\?phone=)\+?(\d{8,15})/i)?.[1];
  return digits ? normalizePhone(`+${digits}`) : "";
}

/** Mapea un canal del actor a candidato; null sin email/teléfono/WhatsApp. Pura: la usa el self-check. */
export function mapYoutubeChannel(item: ApifyItem, plan: Pick<PeopleSearchPlan, "role" | "location">): PersonCandidate | null {
  const channelUrl = text(item.channelUrl) || (text(item.channelHandle, 100) ? `https://www.youtube.com/${text(item.channelHandle, 100).replace(/^@?/, "@")}` : "");
  const name = text(item.channelName, 120) || text(item.channelHandle, 100);
  if (!name || !isUrl(channelUrl)) return null;
  const email = firstEmail(item);
  const phone = firstPhone(item);
  const whatsapp = whatsappOf(text(item.whatsappUrl));
  if (!email && !phone && !whatsapp) return null;

  const socialProfiles: Partial<Record<SocialNetwork, string>> = { youtube: channelUrl };
  for (const [network, key] of [["instagram", "instagramUrl"], ["facebook", "facebookUrl"], ["linkedin", "linkedinUrl"]] as const) {
    const url = text(item[key]);
    if (isUrl(url) && socialNetworkOf(url) === network) socialProfiles[network] = url;
  }
  const websiteRaw = text(item.websiteUrl);
  const website = isUrl(websiteRaw) && !socialNetworkOf(websiteRaw) && !/wa\.me|whatsapp\.com|youtube\.com|youtu\.be|linktr\.ee/i.test(websiteRaw) ? websiteRaw : "";
  const subscribers = text(item.subscriberCountText, 40) || (typeof item.subscriberCount === "number" ? `${item.subscriberCount} subscribers` : "");

  return {
    name,
    role: plan.role,
    location: text(item.country, 80) || plan.location,
    phone,
    whatsapp,
    email,
    website,
    socialProfiles,
    source: "youtube",
    sourceUrl: channelUrl,
    snippet: [text(item.description, 300), subscribers].filter(Boolean).join(" · "),
    isBusiness: businessPattern.test(name),
  };
}

/** Busca canales por keyword + ciudad y país (la búsqueda de YouTube no es geo-estricta; con el país trae más locales). */
export async function searchYoutube(plan: PeopleSearchPlan, opts: { signal?: AbortSignal; limit?: number } = {}): Promise<PersonCandidate[]> {
  const parts = plan.location.split(",").map((part) => part.trim()).filter(Boolean);
  const area = [...new Set([parts[0], parts.at(-1)].filter(Boolean))].join(" ");
  const keywords = plan.keywords.length ? plan.keywords : [plan.role];
  const queries = [...new Set(keywords.map((keyword) => keyword.trim()).filter(Boolean)
    .map((keyword) => (area && !keyword.toLowerCase().includes((parts[0] ?? "").toLowerCase()) ? `${keyword} ${area}` : keyword)))]
    .slice(0, maxQueries);
  if (!queries.length || opts.signal?.aborted) return [];
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 50);
  const perQuery = Math.min(Math.ceil((limit * 3) / queries.length), maxPerQuery);
  const { gl, hl } = serperLocale(plan.location);
  const country = gl.toUpperCase();

  const items = await runApifyActor(youtubeActor, {
    searchQueries: queries,
    maxResultsPerQuery: perQuery,
    maxResults: perQuery * queries.length,
    maxChannelsCheckedPerQuery: maxChannelsChecked,
    ...(actorCountries.has(country) ? { country } : {}),
    ...(actorLanguages.has(hl) ? { language: hl } : {}),
    includeChannelsWithoutEmail: false,
    scanLinkedWebsites: true,
  }, { signal: opts.signal, timeoutMs });

  // La búsqueda mezcla países (p. ej. Córdoba ES/AR): se descartan canales que declaran otro país.
  const accepted = countryAliases(country);
  const seen = new Set<string>();
  const candidates: PersonCandidate[] = [];
  for (const item of items) {
    if (!matchesCountry(item, accepted)) continue;
    const candidate = mapYoutubeChannel(item, plan);
    const key = candidate && (text(item.channelId) || candidate.sourceUrl).toLowerCase();
    if (candidate && key && !seen.has(key)) {
      seen.add(key);
      candidates.push(candidate);
    }
  }
  return candidates.slice(0, limit);
}
