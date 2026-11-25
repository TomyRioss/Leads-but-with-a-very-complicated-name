import { after } from "next/server";
import { aiUsageFields } from "@/lib/ai-usage-fields";
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
  "owner_assistant",
  "leadtita_message_name",
  "explore",
  "other",
] as const;
export type AiFeature = typeof AI_FEATURES[number];

const RECORD_TIMEOUT_MS = 2_000;

const MAX_STEP = 60;

export type AiUsageEntry = {
  feature: AiFeature;
  model: string;
  userId?: string;
  /** OpenRouter `usage` object, stored as tokens, cost, cache, reasoning and server-tool counts. */
  usage?: unknown;
  /** Optional sub-step inside a feature (e.g. "research", "competitors"). */
  step?: string;
};

/**
 * Stores one OpenRouter call's tokens and cost. Never throws; gives up after ~2s.
 * Runs via `after()` so serverless hosts keep it alive past the response; outside a request scope
 * (e.g. inside a cached function) `after` throws and the write runs inline instead.
 */
export async function recordAiUsage(entry: AiUsageEntry) {
  try {
    after(() => writeAiUsage(entry));
  } catch {
    await writeAiUsage(entry);
  }
}

async function writeAiUsage(entry: AiUsageEntry) {
  try {
    if (!isPocketBaseConfigured()) return;
    const step = typeof entry.step === "string" ? entry.step.trim().slice(0, MAX_STEP) : "";
    const body = {
      feature: entry.feature,
      model: String(entry.model || "").slice(0, 120),
      ...(entry.userId ? { user: entry.userId } : {}),
      ...(step ? { step } : {}),
      ...aiUsageFields(entry.usage),
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
