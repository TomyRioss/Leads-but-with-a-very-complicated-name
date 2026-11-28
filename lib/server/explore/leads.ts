import "server-only";
import { createHash } from "node:crypto";
import { parsePhoneNumberFromString } from "libphonenumber-js/mobile";
import { EXPLORE_LEAD_COUNT, type ExploreCampaign, type ExploreLead, type ExploreProduct } from "@/lib/explore/types";
import { actorSearch, mapPlace, type ActorPlace, type SearchFilters } from "@/lib/server/business-search";
import { resolveLocation } from "@/lib/server/geography";
import { splitEvenly } from "@/lib/search-random-location";
import { exploreJson, languageRule, objectSchema, str, UNTRUSTED_RULE, type ExploreLocale, type ReasoningEffort } from "@/lib/server/explore/ai";
import { readAiCache, writeAiCache } from "@/lib/server/ai-cache";
import { EXPLORE_CACHE_TTL_DAYS, leadsCacheKey } from "@/lib/server/explore/dedupe";

const FALLBACK_COUNTRY = "Argentina";
// Solo negocios con teléfono (de ahí sale el WhatsApp), y se piden FETCH_FACTOR veces más: se descartan los que no quedan
// con WhatsApp ni email, porque todo lead de /explorar tiene que poder recibir una propuesta.
const FILTERS: SearchFilters = { website: "any", phone: "with", email: "any", skipClosed: true };
const FETCH_FACTOR = 2;
// The step route allows 300 s; Apify calls must finish (or be abandoned) before that.
const BUDGET_MS = 240_000;
const MIN_CALL_MS = 30_000;
const DESCRIPTION_MAX = 240;
const AI_MIN_MS = 15_000;
const DESCRIPTIONS_EFFORT: ReasoningEffort = "low";

/**
 * Cheap WhatsApp signal, no worker or paid lookup: an explicit wa.me link in the profile, else a phone that is a
 * valid mobile number in international format. Digits (E.164 without +) or "".
 */
export function probableWhatsApp(phone: string, links: string) {
  const fromLink = links.match(/(?:wa\.me\/|api\.whatsapp\.com\/send\?phone=)\+?(\d{8,15})/i)?.[1];
  if (fromLink) return fromLink;
  const value = phone.trim();
  const candidate = value.startsWith("00") ? `+${value.slice(2)}` : value;
  if (!candidate.startsWith("+")) return "";
  const parsed = parsePhoneNumberFromString(candidate);
  return parsed?.isValid() ? parsed.number.slice(1) : "";
}

/**
 * Step 4: up to EXPLORE_LEAD_COUNT businesses for the chosen campaign, from the Apify Maps actor. No credits.
 * Cached across visitors for EXPLORE_CACHE_TTL_DAYS (same country, keywords and locale): a hit skips Apify and the
 * descriptions call. Only complete results are cached (no failed or skipped search, descriptions written).
 */
export async function runLeads(product: ExploreProduct, campaign: ExploreCampaign, locale: ExploreLocale): Promise<ExploreLead[]> {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN is not configured");
  const keywords = campaign.keywords.slice(0, 3);
  const cacheKey = leadsCacheKey(product.country || FALLBACK_COUNTRY, keywords, locale);
  const cached = await readAiCache<ExploreLead[]>("leads", cacheKey);
  if (Array.isArray(cached) && cached.length > 0) return cached;
  const startedAt = Date.now();
  let degraded = false;
  let country = FALLBACK_COUNTRY;
  let countryCode = "";
  try {
    const resolution = await resolveLocation(product.country || FALLBACK_COUNTRY, "", "");
    const resolved = resolution.ok ? resolution : await resolveLocation(FALLBACK_COUNTRY, "", "");
    if (resolved.ok) ({ country, countryCode } = resolved.location);
  } catch {
    // Dataset unavailable: search by the fallback name without the country filter.
  }
  const monitorName = `leadta-explore-${createHash("sha256").update(country.toLowerCase()).digest("hex").slice(0, 24)}`;
  const leads = new Map<string, ExploreLead>();

  const add = (places: ActorPlace[]) => {
    for (const place of places) {
      if (leads.size >= EXPLORE_LEAD_COUNT) break;
      const placeCountry = typeof place.countryCode === "string" ? place.countryCode.toUpperCase() : "";
      if (countryCode && placeCountry && placeCountry !== countryCode) continue;
      const mapped = mapPlace(place);
      if (!mapped.name || leads.has(mapped.source_key)) continue;
      const whatsapp = probableWhatsApp(mapped.phone, `${mapped.social_profiles}\n${mapped.website}`);
      if (!whatsapp && !mapped.email) continue;
      leads.set(mapped.source_key, {
        id: createHash("sha256").update(mapped.source_key).digest("hex").slice(0, 16),
        name: mapped.name,
        category: mapped.category,
        // Texto de Maps: solo materia prima para la IA (describeLeads); queda como respaldo si la IA falla.
        description: (str(place.description, DESCRIPTION_MAX) || str(mapped.source_context.owner_description, DESCRIPTION_MAX)),
        address: mapped.address,
        country_code: str(place.countryCode, 2).toUpperCase(),
        city: str(place.city, 80),
        district: str(place.neighborhood, 80),
        phone: mapped.phone,
        whatsapp,
        email: mapped.email,
        website: mapped.website,
        maps_url: mapped.maps_url,
        average_rating: mapped.average_rating,
        review_count: mapped.review_count,
      });
    }
  };
  const search = async (keyword: string, limit: number) => {
    const timeoutMs = BUDGET_MS - (Date.now() - startedAt);
    if (limit <= 0) return { limit, places: [] as ActorPlace[] };
    if (timeoutMs < MIN_CALL_MS) {
      degraded = true;
      return { limit, places: [] as ActorPlace[] };
    }
    try {
      return { limit, places: await actorSearch(token, keyword, country, limit * FETCH_FACTOR, monitorName, FILTERS, timeoutMs) };
    } catch (error) {
      console.error("Explore leads search failed:", error instanceof Error ? error.message : "unknown");
      degraded = true;
      return { limit, places: [] as ActorPlace[] };
    }
  };

  // Keywords in parallel, the count split between them; then one pass more on the keywords that still had results.
  const shares = splitEvenly(EXPLORE_LEAD_COUNT, keywords.length);
  const first = await Promise.all(keywords.map((keyword, index) => search(keyword, shares[index])));
  for (const { places } of first) add(places);
  const missing = EXPLORE_LEAD_COUNT - leads.size;
  const saturated = keywords.filter((_, index) => first[index].places.length >= first[index].limit * FETCH_FACTOR);
  if (missing > 0 && saturated.length > 0) {
    const extra = splitEvenly(missing, saturated.length);
    const second = await Promise.all(saturated.map((keyword, index) => search(keyword, shares[keywords.indexOf(keyword)] + extra[index])));
    for (const { places } of second) add(places);
  }
  if (leads.size === 0) throw new Error("leads: no results with WhatsApp or email");
  const result = [...leads.values()];
  const described = await describeLeads(result, locale, BUDGET_MS - (Date.now() - startedAt));
  if (described && !degraded) await writeAiCache("leads", cacheKey, result, EXPLORE_CACHE_TTL_DAYS);
  return result;
}

/**
 * One AI call writes every description in its own words (never the Maps text verbatim), using name, category, address
 * and the Maps text as source data. Best effort: on failure each lead keeps the Maps text (or ""). True when the model answered.
 */
async function describeLeads(leads: ExploreLead[], locale: ExploreLocale, budgetMs: number) {
  if (!leads.length || budgetMs < AI_MIN_MS) return false;
  const schema = objectSchema({
    items: { type: "array", items: objectSchema({ id: { type: "string" }, description: { type: "string", maxLength: DESCRIPTION_MAX } }) },
  });
  const system = [
    "For each business, write one short sentence (max 20 words) in your own words saying what it is and what makes it distinct for a salesperson (specialty, type of cuisine or service, audience).",
    "Use the name, category, address and the 'source' text as data; never copy the source text, never repeat the business name or city, never use generic filler like \"offers gastronomic service\".",
    "With little data, describe it plainly from its category and name (e.g. \"Restaurante de mariscos frente al mar\" if the name suggests it). Never mention the source, missing data, or what the salesperson should do.",
    "Do not invent facts like years, awards or prices. Return every given id once.",
    UNTRUSTED_RULE,
    languageRule(locale),
  ].join(" ");
  const user = leads.map((lead) => `${lead.id} | ${lead.name} | ${lead.category} | ${lead.address} | source: ${lead.description || "-"}`).join("\n");
  try {
    const result = await exploreJson({ name: "explore_lead_descriptions", schema, system, user, maxTokens: 60 * leads.length + 200, timeoutMs: Math.min(budgetMs, 60_000), effort: DESCRIPTIONS_EFFORT, step: "lead_descriptions" });
    const byId = new Map(leads.map((lead) => [lead.id, lead]));
    for (const item of Array.isArray(result.items) ? result.items : []) {
      const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
      const lead = byId.get(str(record.id, 40));
      const description = str(record.description, DESCRIPTION_MAX);
      if (lead && description) lead.description = description;
    }
    return true;
  } catch (error) {
    console.error("Explore lead descriptions failed:", error instanceof Error ? error.message : "unknown");
    return false;
  }
}
