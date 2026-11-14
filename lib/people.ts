import type { Lead, SocialNetwork } from "@/lib/types";

export const CREDITS_PER_PERSON = 4;
/** Scrapers the router (Jev) can pick. "web" is only a stored fallback label, never routed. */
export const SEARCH_SOURCES = ["serper", "github", "instagram", "facebook", "tiktok", "youtube", "fiverr", "behance"] as const;
export type SearchSource = (typeof SEARCH_SOURCES)[number];
export type PersonSource = SearchSource | "web";
export type ProfileType = "trade" | "commercial" | "technical" | "professional" | "freelance";
export interface PersonCandidate { name: string; role: string; location: string; phone: string; whatsapp: string; email: string; website: string; socialProfiles: Partial<Record<SocialNetwork, string>>; source: PersonSource; sourceUrl: string; snippet: string; isBusiness?: boolean; }
/**
 * intent: one line of what the user wants (from DeepSeek), input for the router.
 * keywords: 1–4 short phrases (no location) to search inside platforms (Instagram, TikTok, YouTube, Fiverr…).
 * sources: scrapers picked by the router; empty until routed.
 */
export interface PeopleSearchPlan { profileType: ProfileType; role: string; location: string; summary: string; intent: string; keywords: string[]; webQueries: string[]; githubQuery: string | null; instagramQueries: string[]; facebookGroupQueries: string[]; sources: SearchSource[]; }
export interface PeopleSearchRequest { query: string; location: string; count: number; locale: "es" | "en"; includeMeta?: boolean; } // count 1..25, includeMeta default true
export interface PeopleSearchResponse { batchId: string; plan: PeopleSearchPlan; delivered: number; charged: number; refunded: number; leads: Lead[]; }

const filled = (value: string | undefined) => Boolean(value?.trim());

/** One point each: WhatsApp, email, at least one social profile, analyzed pains. 0..4. */
export function completenessOf(p: Pick<PersonCandidate, "whatsapp" | "email" | "socialProfiles">, hasPains: boolean): number {
  const hasSocial = Object.values(p.socialProfiles ?? {}).some(filled);
  return [filled(p.whatsapp), filled(p.email), hasSocial, hasPains].filter(Boolean).length;
}

/** A person is deliverable (and billable) only with an email, phone or WhatsApp. */
export function hasContact(p: Pick<PersonCandidate, "phone" | "whatsapp" | "email">): boolean {
  return filled(p.phone) || filled(p.whatsapp) || filled(p.email);
}
