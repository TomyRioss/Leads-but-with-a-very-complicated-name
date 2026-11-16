// Discount campaigns: shared types and pure pricing rules (safe for client and server).

export const CAMPAIGN_FEATURES = ["lead_search", "people_search", "pain_analysis"] as const;
export type CampaignFeature = (typeof CAMPAIGN_FEATURES)[number];

export type Campaign = {
  id: string;
  name: string;
  /** Short pill text, e.g. "Oferta Única". */
  label: string;
  /** Banner text, e.g. "50% OFF en todos los servicios hasta el 22/11". */
  message: string;
  discountPercent: number;
  allFeatures: boolean;
  features: CampaignFeature[];
  startsAt: string;
  endsAt: string;
  active: boolean;
};

/** What the public sees: the banner of the strongest live campaign and the discount per feature (0 = none). */
export type LiveCampaigns = {
  banner: { label: string; message: string; endsAt: string } | null;
  discounts: Record<CampaignFeature, number>;
};

export const isCampaignFeature = (value: unknown): value is CampaignFeature =>
  typeof value === "string" && (CAMPAIGN_FEATURES as readonly string[]).includes(value);

export function isLive(campaign: Pick<Campaign, "active" | "startsAt" | "endsAt">, now = Date.now()) {
  const start = Date.parse(campaign.startsAt);
  const end = Date.parse(campaign.endsAt);
  return campaign.active && Number.isFinite(start) && Number.isFinite(end) && start <= now && now < end;
}

const coversFeature = (campaign: Campaign, feature: CampaignFeature) => campaign.allFeatures || campaign.features.includes(feature);

/** Overlapping campaigns never stack: each feature takes the highest live discount; the banner is that strongest campaign's. */
export function liveCampaigns(campaigns: readonly Campaign[], now = Date.now()): LiveCampaigns {
  const live = campaigns.filter((campaign) => isLive(campaign, now)).sort((a, b) => b.discountPercent - a.discountPercent);
  const discounts = Object.fromEntries(CAMPAIGN_FEATURES.map((feature) => [
    feature,
    live.find((campaign) => coversFeature(campaign, feature))?.discountPercent ?? 0,
  ])) as Record<CampaignFeature, number>;
  const top = live[0];
  return { banner: top ? { label: top.label, message: top.message, endsAt: top.endsAt } : null, discounts };
}

/**
 * Credits for `units` of a feature at `unitCost`, after `percent` off. Rounded on the total (not per unit) and up,
 * so 50% of 2 credits/lead is exactly 1 per lead and odd totals never charge a fraction.
 */
export function discountedCost(units: number, unitCost: number, percent: number) {
  const base = Math.max(0, units) * unitCost;
  const pct = Math.min(100, Math.max(0, percent));
  return pct === 0 ? base : Math.ceil(base * (100 - pct) / 100);
}
