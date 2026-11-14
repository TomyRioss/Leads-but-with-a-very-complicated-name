import { SEARCH_SOURCES, type PeopleSearchPlan, type SearchSource } from "@/lib/people";
import { extractJsonObject, messageText } from "./planner";
import { recordAiUsage } from "@/lib/server/ai-usage";

// Jev (OpenRouter) solo enruta: lee la intención que interpretó DeepSeek y elige qué scrapers correr.
const MODEL = "typesafe/jev-router";
const TIMEOUT_MS = 15_000;
const MAX_SOURCES = 5;

/** Qué encuentra cada scraper. Es lo único que Jev ve de las fuentes. */
export const SOURCE_CATALOG: Record<SearchSource, string> = {
  serper: "Google web search: personal pages, CVs, LinkedIn profiles, personal Facebook posts. Useful for almost any request; geo-targeted by country.",
  github: "GitHub user search: software developers only.",
  instagram: "Instagram profiles with a public email/phone: influencers, content creators, coaches, trainers, beauty, food, photographers, local professionals and trades that sell on Instagram. Keyword search, worldwide.",
  facebook: "Posts in local Facebook groups: tradespeople and home services (electricians, plumbers, cleaning) offering work in a city or neighborhood of Latin America.",
  tiktok: "TikTok creators with a public email: influencers and content creators. No location filter.",
  youtube: "YouTube channels with a public email: influencers, creators, educators, coaches, reviewers.",
  fiverr: "Fiverr sellers with public contact: online freelancers (developers, designers, video editors, writers, marketers, translators).",
  behance: "Behance creatives: graphic/UI designers, illustrators, photographers, art directors.",
};

const influencer = /influenc|creador|creator|youtuber|tiktoker|streamer|content|contenido|blogger|instagramer/i;
const creative = /dise[ñn]|design|ilustr|illustrat|fot[oó]graf|photograph|art director|director de arte|\bux\b|\bui\b/i;

/** Tabla fija si Jev falla: por intención y tipo de perfil. Pura. */
export function defaultSources(plan: Pick<PeopleSearchPlan, "profileType" | "intent" | "role">): SearchSource[] {
  const text = `${plan.intent} ${plan.role}`;
  if (influencer.test(text)) return ["instagram", "tiktok", "youtube", "serper"];
  if (creative.test(text)) return ["behance", "instagram", "fiverr", "serper"];
  switch (plan.profileType) {
    case "trade": return ["serper", "facebook", "instagram"];
    case "technical": return ["serper", "github", "fiverr"];
    case "freelance": return ["serper", "fiverr", "instagram"];
    default: return ["serper", "instagram"];
  }
}

/**
 * Lista final: solo ids conocidos, sin repetidos, máx 5, Google siempre (barato y alimenta la ronda extra),
 * y sin fuentes que no pueden correr con este plan. Pura.
 */
export function sanitizeSources(raw: unknown, plan: Pick<PeopleSearchPlan, "githubQuery" | "facebookGroupQueries">): SearchSource[] {
  const picked = Array.isArray(raw) ? raw.filter((id): id is SearchSource => SEARCH_SOURCES.includes(id as SearchSource)) : [];
  const allowed = [...new Set<SearchSource>(["serper", ...picked])].filter((id) =>
    (id !== "github" || Boolean(plan.githubQuery))
    && (id !== "facebook" || plan.facebookGroupQueries.length > 0));
  return allowed.slice(0, MAX_SOURCES);
}

const schema = {
  type: "object",
  additionalProperties: false,
  properties: { sources: { type: "array", items: { type: "string", enum: [...SEARCH_SOURCES] } } },
  required: ["sources"],
};

function prompt(plan: PeopleSearchPlan) {
  return [
    "You route a people search to scrapers. Pick the 2 to 5 sources where these people are most likely to publish their own contact. Do not pick sources that cannot contain them.",
    `Intent: ${plan.intent}`,
    `Profile type: ${plan.profileType}. Role: ${plan.role}. Location: ${plan.location || "unspecified"}.`,
    "Sources:",
    ...SEARCH_SOURCES.map((id) => `- ${id}: ${SOURCE_CATALOG[id]}`),
    'Return JSON: {"sources": [ids]}.',
  ].join("\n");
}

export type RoutedSources = { sources: SearchSource[]; routedBy: "jev" | "fallback" };

/** Jev elige las fuentes; si falla, tarda o devuelve algo inválido, usa la tabla fija. Nunca lanza. */
export async function routeSources(plan: PeopleSearchPlan, signal?: AbortSignal, userId?: string): Promise<RoutedSources> {
  const fallback = (): RoutedSources => ({ sources: sanitizeSources(defaultSources(plan), plan), routedBy: "fallback" });
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return fallback();
  try {
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        response_format: { type: "json_schema", json_schema: { name: "people_search_sources", strict: true, schema } },
        messages: [{ role: "user", content: prompt(plan) }],
        max_tokens: 1024,
        temperature: 0,
      }),
      cache: "no-store",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok) throw new Error(`OpenRouter responded ${response.status}`);
    const payload = await response.json() as { choices?: { message?: { content?: unknown; reasoning?: unknown } }[]; usage?: unknown };
    void recordAiUsage({ feature: "people_router", model: MODEL, userId, usage: payload.usage });
    const raw = extractJsonObject(messageText(payload.choices?.[0]?.message));
    const sources = sanitizeSources(raw?.sources, plan);
    // Solo Google no es una decisión: Jev no eligió nada válido.
    return sources.length > 1 ? { sources, routedBy: "jev" } : fallback();
  } catch (error) {
    if (!signal?.aborted) console.warn("[people/router] Jev failed, using fallback:", error instanceof Error ? error.message.slice(0, 160) : "unknown");
    return fallback();
  }
}
