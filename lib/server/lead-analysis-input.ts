// Pure helpers for lead analysis input and cross-user cache keys (no runtime imports: the selfcheck runs them with plain node).
import type { LeadReview } from "@/lib/types";

/** Reviews sent to the pain analysis: low ratings first (stable), capped count and lengths to bound tokens. */
export const PAIN_MAX_REVIEWS = 20;
export const PAIN_REVIEW_TEXT_MAX = 800;
export const PAIN_OWNER_REPLY_MAX = 300;

export function selectPainReviews(reviews: LeadReview[]): LeadReview[] {
  const priority = (rating: number | null) => rating !== null && rating <= 3 ? 0 : 1;
  return [...reviews]
    .sort((a, b) => priority(a.rating) - priority(b.rating))
    .slice(0, PAIN_MAX_REVIEWS)
    .map((review) => ({
      ...review,
      text: review.text.slice(0, PAIN_REVIEW_TEXT_MAX),
      owner_response: review.owner_response.slice(0, PAIN_OWNER_REPLY_MAX),
    }));
}

/** Stable Google place identity from a saved maps_url: query_place_id, cid or the 0x..:0x.. feature id. "" when unknown. */
export function placeKeyFromMapsUrl(mapsUrl: string): string {
  const raw = mapsUrl.trim();
  if (!raw) return "";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "";
  }
  const placeId = url.searchParams.get("query_place_id")?.trim();
  if (placeId && /^[\w-]{10,}$/.test(placeId)) return `pid:${placeId}`;
  const cid = url.searchParams.get("cid")?.trim();
  if (cid && /^\d{5,}$/.test(cid)) return `cid:${cid}`;
  const feature = decodeURIComponent(url.pathname + url.search).match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i)?.[1];
  return feature ? `fid:${feature.toLowerCase()}` : "";
}

// Hosts shared by many businesses (social, link-in-bio, messaging): a domain there does not identify one business.
const sharedHosts = /(^|\.)(facebook\.com|fb\.com|instagram\.com|youtube\.com|youtu\.be|linkedin\.com|tiktok\.com|twitter\.com|x\.com|linktr\.ee|wa\.me|whatsapp\.com|google\.com|goo\.gl|bit\.ly|beacons\.ai|taplink\.cc|bio\.link|linkin\.bio)$/i;

/** Normalized website host ("www." stripped, lower case) when it identifies one business; "" otherwise. */
export function businessDomain(website: string): string {
  try {
    const url = new URL(website.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return host.includes(".") && !sharedHosts.test(host) ? host : "";
  } catch {
    return "";
  }
}

/**
 * Enrichment cache key: business identity (place, else own domain) + sorted requested networks + sorted fields the
 * model was asked to find (a result searched without "email" must not answer a request that needs it). "" = do not cache.
 */
export function enrichmentCacheKey(input: { mapsUrl: string; website: string; networks: string[]; missing: string[] }): string {
  const identity = placeKeyFromMapsUrl(input.mapsUrl) || (businessDomain(input.website) ? `dom:${businessDomain(input.website)}` : "");
  if (!identity) return "";
  const sorted = (values: string[]) => [...new Set(values)].sort().join(",");
  return `${identity}|n=${sorted(input.networks)}|m=${sorted(input.missing)}`;
}

/** Pain cache key: only for analyses without a user focus (focus-specific results are never shared). "" = do not cache. */
export function painCacheKey(input: { mapsUrl: string; focus: string; locale: string }): string {
  if (input.focus.trim()) return "";
  const identity = placeKeyFromMapsUrl(input.mapsUrl);
  return identity ? `${identity}|l=${input.locale}` : "";
}
