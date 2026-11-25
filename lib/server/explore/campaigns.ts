import "server-only";
import type { ExploreCampaign, ExploreCompetitors, ExploreProduct } from "@/lib/explore/types";
import { exploreJson, languageRule, objectSchema, str, strList, UNTRUSTED_RULE, type ExploreLive, type ExploreLocale, type ReasoningEffort } from "@/lib/server/explore/ai";

const ICONS: readonly ExploreCampaign["icon"][] = ["store", "utensils", "graduation", "map-pin", "briefcase", "heart-pulse", "wrench", "building", "shopping-cart", "sparkles"];
const MAX_CAMPAIGNS = 6;
const EFFORT: ReasoningEffort = "low";

const schema = objectSchema({
  campaigns: {
    type: "array",
    maxItems: MAX_CAMPAIGNS,
    items: objectSchema({
      name: { type: "string", maxLength: 60 },
      icon: { type: "string", enum: ICONS },
      fit: { type: "integer", minimum: 0, maximum: 100 },
      pitch: { type: "string", maxLength: 200 },
      pain: { type: "string", maxLength: 200 },
      criteria: { type: "array", maxItems: 3, items: { type: "string", maxLength: 100 } },
      examples: { type: "array", maxItems: 3, items: { type: "string", maxLength: 60 } },
      keywords: { type: "array", maxItems: 3, items: { type: "string", maxLength: 60 } },
    }),
  },
});

function slug(value: string) {
  return value.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "campaign";
}

/** Step 3: target business types (Google Maps searchable) ranked by fit. */
export async function runCampaigns(product: ExploreProduct, competitors: ExploreCompetitors, locale: ExploreLocale, live?: ExploreLive): Promise<ExploreCampaign[]> {
  const system = [
    `You pick the ${MAX_CAMPAIGNS} best types of local businesses (findable on a maps search) to sell this product to.`,
    "Each campaign is one business type (e.g. \"Restaurants\", \"Real estate agencies\"). No overlapping types.",
    "fit: 0-100 affinity of that business type with the product. Order campaigns from highest to lowest fit.",
    "pitch: one sentence on why the product helps them; wrap 1-2 key words in **double asterisks**.",
    "pain: one sentence with the concrete problem the product solves for them.",
    "criteria: exactly 3 short qualifying criteria of a good prospect.",
    "examples: 2-3 concrete sub-types of that business.",
    `keywords: 1-3 maps search keywords for that business type, written in the main language of ${product.country || "the target market"} (e.g. \"inmobiliaria\" for Argentina).`,
    "icon: the closest icon from the enum.",
    UNTRUSTED_RULE,
    languageRule(locale),
  ].join(" ");
  const user = [
    `Product: ${product.name}`,
    `Summary: ${product.summary}`,
    `Category: ${competitors.headline}`,
    `Value propositions: ${competitors.valueProps.join("; ")}`,
    `Market: ${product.location || product.country || "(unknown)"}`,
  ].join("\n");
  const result = await exploreJson({ name: "explore_campaigns", schema, system, user, maxTokens: 3000, live, effort: EFFORT, step: "campaigns" });

  const ids = new Set<string>();
  const campaigns = (Array.isArray(result.campaigns) ? result.campaigns : []).flatMap((item): ExploreCampaign[] => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const name = str(record.name, 60);
    const keywords = strList(record.keywords, 3, 60);
    if (!name || keywords.length === 0) return [];
    let id = slug(name);
    for (let n = 2; ids.has(id); n++) id = `${slug(name)}-${n}`;
    ids.add(id);
    const fit = Math.round(Number(record.fit));
    return [{
      id,
      name,
      icon: ICONS.includes(record.icon as ExploreCampaign["icon"]) ? record.icon as ExploreCampaign["icon"] : "sparkles",
      fit: Number.isFinite(fit) ? Math.min(100, Math.max(0, fit)) : 50,
      pitch: str(record.pitch, 200),
      pain: str(record.pain, 200),
      criteria: strList(record.criteria, 3, 100),
      examples: strList(record.examples, 3, 60),
      keywords,
    }];
  }).sort((a, b) => b.fit - a.fit).slice(0, MAX_CAMPAIGNS);
  if (campaigns.length === 0) throw new Error("campaigns: empty result");
  return campaigns;
}
