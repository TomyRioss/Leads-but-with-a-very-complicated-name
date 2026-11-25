import "server-only";
import type { ExploreCompetitors, ExploreProduct } from "@/lib/explore/types";
import { readAiCache, writeAiCache } from "@/lib/server/ai-cache";
import { exploreJson, hostOf, languageRule, objectSchema, str, strList, UNTRUSTED_RULE, webSearchTool, type ExploreLive, type ExploreLocale, type ReasoningEffort } from "@/lib/server/explore/ai";
import { competitorsCacheKey, EXPLORE_CACHE_TTL_DAYS } from "@/lib/server/explore/dedupe";

const EFFORT: ReasoningEffort = "low";

const schema = objectSchema({
  headline: { type: "string", maxLength: 80 },
  valueProps: { type: "array", maxItems: 3, items: { type: "string", maxLength: 120 } },
  buyerSearches: { type: "array", maxItems: 3, items: { type: "string", maxLength: 100 } },
  competitors: {
    type: "array",
    maxItems: 8,
    items: objectSchema({ name: { type: "string", maxLength: 80 }, domain: { type: "string", maxLength: 120 } }),
  },
});

/** "linktr.ee" → "Linktr". */
const nameOf = (domain: string) => (domain ? domain.split(".")[0].replace(/^./, (char) => char.toUpperCase()) : "");

const isCompetitors = (value: unknown): value is ExploreCompetitors => {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : null;
  return Boolean(record && typeof record.headline === "string" && record.headline && Array.isArray(record.valueProps)
    && Array.isArray(record.buyerSearches) && Array.isArray(record.competitors) && record.competitors.length > 0);
};

/**
 * Step 2: positioning and real competitors found with web_search.
 * Cached across users for EXPLORE_CACHE_TTL_DAYS (same product domain or name+summary, market and locale): a hit skips the model.
 */
export async function runCompetitors(product: ExploreProduct, locale: ExploreLocale, live?: ExploreLive): Promise<ExploreCompetitors> {
  const cacheKey = competitorsCacheKey(product, locale);
  const cached = await readAiCache<ExploreCompetitors>("competitors", cacheKey);
  if (isCompetitors(cached)) {
    live?.text(JSON.stringify(cached)); // One chunk so the card renders like a live answer.
    return cached;
  }
  const system = [
    "You map the market of a product for a sales tool.",
    "Call web_search to find real competitors that sell a similar product to the same kind of customer, in the product's market when known.",
    "headline: a short category label for the product (2-6 words, e.g. \"No-code small business pages\").",
    "valueProps: exactly 3 short value propositions of the product.",
    "buyerSearches: exactly 3 typical searches a buyer types when looking for this kind of product.",
    "competitors: 4 to 8 real companies with their official website domain (e.g. \"wix.com\"). Only companies you found in search results; never the product itself; no marketplaces or review sites.",
    UNTRUSTED_RULE,
    languageRule(locale),
  ].join(" ");
  const user = `Product: ${product.name}\nWebsite: ${product.domain || "(none)"}\nSummary: ${product.summary}\nMarket: ${product.location || product.country || "(unknown)"}`;
  const result = await exploreJson({ name: "explore_competitors", schema, system, user, tools: [webSearchTool(2)], maxToolCalls: 3, maxTokens: 1500, live, effort: EFFORT, step: "competitors" });

  const seen = new Set(product.domain ? [product.domain] : []);
  const competitors = (Array.isArray(result.competitors) ? result.competitors : []).flatMap((item) => {
    // With web_search on, the model sometimes returns bare domains ("wix.com") instead of {name, domain}.
    const record = typeof item === "string" ? { domain: item } : item && typeof item === "object" ? item as Record<string, unknown> : null;
    if (!record) return [];
    const domain = hostOf(record.domain);
    const name = str(record.name, 80) || nameOf(domain);
    if (!name || !domain || seen.has(domain)) return [];
    seen.add(domain);
    return [{ name, domain }];
  }).slice(0, 8);
  const headline = str(result.headline, 80);
  if (!headline || competitors.length === 0) throw new Error("competitors: empty result");
  const value: ExploreCompetitors = {
    headline,
    valueProps: strList(result.valueProps, 3, 120),
    buyerSearches: strList(result.buyerSearches, 3, 100),
    competitors,
  };
  await writeAiCache("competitors", cacheKey, value, EXPLORE_CACHE_TTL_DAYS);
  return value;
}
