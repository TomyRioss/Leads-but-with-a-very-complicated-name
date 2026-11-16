import { pocketBaseFetch } from "@/lib/server/pocketbase";
import { discountedCost, isCampaignFeature, liveCampaigns, type Campaign, type CampaignFeature, type LiveCampaigns } from "@/lib/campaigns";

const COLLECTION = "campaigns";
const CACHE_MS = 60_000;

type CampaignRecord = {
  id: string; name?: string; label?: string; message?: string; discount_percent?: number;
  all_features?: boolean; features?: unknown; starts_at?: string; ends_at?: string; active?: boolean;
};

export function toCampaign(record: CampaignRecord): Campaign {
  return {
    id: record.id,
    name: record.name ?? "",
    label: record.label ?? "",
    message: record.message ?? "",
    discountPercent: Number(record.discount_percent) || 0,
    allFeatures: record.all_features === true,
    features: Array.isArray(record.features) ? record.features.filter(isCampaignFeature) : [],
    // PocketBase returns "2026-11-22 02:59:59.000Z"; Safari's Date.parse needs the ISO "T".
    startsAt: (record.starts_at ?? "").replace(" ", "T"),
    endsAt: (record.ends_at ?? "").replace(" ", "T"),
    active: record.active === true,
  };
}

/** Every campaign, newest window first (owner panel). */
export async function listCampaigns(): Promise<Campaign[]> {
  const page = await pocketBaseFetch<{ items: CampaignRecord[] }>(`/api/collections/${COLLECTION}/records?perPage=200&skipTotal=1&sort=-starts_at`);
  return page.items.map(toCampaign);
}

// ponytail: per-instance 60 s cache; owner writes call invalidateCampaignCache() on this instance, other instances catch up within a minute.
let cache: { at: number; campaigns: Promise<Campaign[]> } | null = null;

/** Active campaigns that have not ended yet (live or upcoming), cached. Errors fail open to "no discount". */
function activeCampaigns(): Promise<Campaign[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.campaigns;
  const filter = encodeURIComponent(`active = true && ends_at > "${new Date().toISOString().replace("T", " ")}"`);
  const campaigns = pocketBaseFetch<{ items: CampaignRecord[] }>(`/api/collections/${COLLECTION}/records?perPage=50&skipTotal=1&filter=${filter}`)
    .then((page) => page.items.map(toCampaign))
    .catch((error: unknown) => {
      console.error("Campaigns load failed:", error instanceof Error ? error.message : "unknown");
      cache = null;
      return [] as Campaign[];
    });
  cache = { at: Date.now(), campaigns };
  return campaigns;
}

export function invalidateCampaignCache() {
  cache = null;
}

export async function getLiveCampaigns(): Promise<LiveCampaigns> {
  return liveCampaigns(await activeCampaigns());
}

/** Discount (0-100) live right now for a feature. */
export async function featureDiscount(feature: CampaignFeature): Promise<number> {
  return (await getLiveCampaigns()).discounts[feature];
}

/** Pricing for one request: read the discount once and reuse it for reserve and settle so both use the same rate. */
export async function featurePricing(feature: CampaignFeature, unitCost: number) {
  const percent = await featureDiscount(feature);
  return { percent, cost: (units: number) => discountedCost(units, unitCost, percent) };
}
