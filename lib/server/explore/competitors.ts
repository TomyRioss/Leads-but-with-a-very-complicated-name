import "server-only";
import type { ExploreCompetitors, ExploreProduct } from "@/lib/explore/types";
import { exploreJson, hostOf, languageRule, objectSchema, str, strList, UNTRUSTED_RULE, webSearchTool, type ExploreLocale } from "@/lib/server/explore/ai";

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

/** Step 2: positioning and real competitors found with web_search. */
export async function runCompetitors(product: ExploreProduct, locale: ExploreLocale): Promise<ExploreCompetitors> {
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
  const result = await exploreJson({ name: "explore_competitors", schema, system, user, tools: [webSearchTool(2)], maxToolCalls: 3, maxTokens: 1500 });

  const seen = new Set(product.domain ? [product.domain] : []);
  const competitors = (Array.isArray(result.competitors) ? result.competitors : []).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const name = str(record.name, 80);
    const domain = hostOf(record.domain);
    if (!name || !domain || seen.has(domain)) return [];
    seen.add(domain);
    return [{ name, domain }];
  }).slice(0, 8);
  const headline = str(result.headline, 80);
  if (!headline || competitors.length === 0) throw new Error("competitors: empty result");
  return {
    headline,
    valueProps: strList(result.valueProps, 3, 120),
    buyerSearches: strList(result.buyerSearches, 3, 100),
    competitors,
  };
}
