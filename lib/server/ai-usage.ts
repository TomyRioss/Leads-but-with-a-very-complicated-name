import { after } from "next/server";
import { isPocketBaseConfigured, pocketBaseFetch } from "@/lib/server/pocketbase";

export const AI_FEATURES = [
  "leadtita_chat",
  "lead_suite_insights",
  "lead_suite_report",
  "attachment_extract",
  "people_router",
  "people_planner",
  "people_classify",
  "lead_analysis",
  "contact_ai_fill",
  "other",
] as const;
export type AiFeature = typeof AI_FEATURES[number];

const RECORD_TIMEOUT_MS = 2_000;

function nonNegative(value: unknown, integer: boolean) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return integer ? Math.round(parsed) : parsed;
}

/**
 * Stores one OpenRouter call's tokens and cost. Never throws; gives up after ~2s.
 * Runs via `after()` so serverless hosts keep it alive past the response; outside a request scope
 * (e.g. inside a cached function) `after` throws and the write runs inline instead.
 */
export async function recordAiUsage(entry: Parameters<typeof writeAiUsage>[0]) {
  try {
    after(() => writeAiUsage(entry));
  } catch {
    await writeAiUsage(entry);
  }
}

async function writeAiUsage(entry: { feature: AiFeature; model: string; userId?: string; usage?: unknown }) {
  try {
    if (!isPocketBaseConfigured()) return;
    const usage = entry.usage && typeof entry.usage === "object" ? entry.usage as Record<string, unknown> : {};
    const body = {
      feature: entry.feature,
      model: String(entry.model || "").slice(0, 120),
      ...(entry.userId ? { user: entry.userId } : {}),
      prompt_tokens: nonNegative(usage.prompt_tokens, true),
      completion_tokens: nonNegative(usage.completion_tokens, true),
      cost_usd: nonNegative(usage.cost, false),
    };
    const signal = AbortSignal.timeout(RECORD_TIMEOUT_MS);
    await Promise.race([
      pocketBaseFetch("/api/collections/ai_usage/records", { method: "POST", body: JSON.stringify(body), signal }),
      new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })),
    ]);
  } catch (error) {
    console.error("ai_usage record failed", error instanceof Error ? error.name : "unknown");
  }
}
