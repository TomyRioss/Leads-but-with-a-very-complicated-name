import "server-only";
import type { ExploreInput, ExploreProduct } from "@/lib/explore/types";
import { resolveLocation } from "@/lib/server/geography";
import { exploreJson, hostOf, languageRule, objectSchema, str, UNTRUSTED_RULE, webFetchTool, webSearchTool, type ExploreLive, type ExploreLocale } from "@/lib/server/explore/ai";

const schema = objectSchema({
  name: { type: "string", maxLength: 80 },
  summary: { type: "string", maxLength: 400 },
  location: { type: "string", maxLength: 80 },
  country: { type: "string", maxLength: 60 },
});

function describeInput(input: ExploreInput) {
  if (input.mode === "web") return `Website of the product: ${input.url}`;
  if (input.mode === "text") return `Product description written by the visitor:\n"""${input.description}"""`;
  return `Services answers written by the visitor:\nWhat they offer: """${input.offer}"""\nIdeal customer: """${input.idealCustomer}"""\nMarkets / regions: """${input.markets}"""`;
}

/** Canonical country name for Apify searches, or "" when unknown. */
export async function canonicalCountry(value: string) {
  if (!value) return "";
  try {
    const resolution = await resolveLocation(value, "", "");
    return resolution.ok ? resolution.location.country : "";
  } catch {
    return "";
  }
}

/** Step 1: product card. Web mode reads the site (web_fetch) and searches the web; text/services derive it from the visitor's words. */
export async function runResearch(input: ExploreInput, locale: ExploreLocale, live?: ExploreLive): Promise<ExploreProduct> {
  const domain = input.mode === "web" ? hostOf(input.url) : "";
  const web = input.mode === "web" && Boolean(domain);
  const system = [
    "You profile a product or service so a sales tool can find its customers.",
    web
      ? `First call web_fetch on ${input.mode === "web" ? input.url : ""} to read the site; use web_search at most once only if the site is unreadable. Base every field on what you read.`
      : "Derive every field only from the visitor's text. Do not invent facts that are not implied by it.",
    "name: the product or company name (short); if none is given, a short descriptive name.",
    "summary: 1-2 sentences: what it is, for whom, and its main benefit.",
    "location: main country or region where it sells, or \"\" if unknown.",
    "country: the single main country name in English (e.g. \"Argentina\", \"Spain\", \"United States\"), or \"\" if unknown.",
    UNTRUSTED_RULE,
    languageRule(locale),
  ].join(" ");
  const result = await exploreJson({
    name: "explore_product",
    schema,
    system,
    user: describeInput(input),
    tools: web ? [webFetchTool(2, [domain]), webSearchTool(1)] : [],
    maxToolCalls: 3,
    maxTokens: 1200,
    live,
  });
  const name = str(result.name, 80);
  const summary = str(result.summary, 400);
  if (!name || !summary) throw new Error("research: empty product");
  return {
    name,
    domain,
    summary,
    location: str(result.location, 80),
    country: await canonicalCountry(str(result.country, 60)),
  };
}
