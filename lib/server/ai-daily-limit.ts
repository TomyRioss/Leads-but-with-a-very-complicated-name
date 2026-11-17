import { NextResponse } from "next/server";
import type { Translator } from "@/lib/server/locale";
import { pocketBaseFetch } from "@/lib/server/pocketbase";
import { AI_RATE, rateLimited } from "@/lib/server/rate-limit";
import { hasActivePlan } from "@/lib/server/usage-limits";

/** Lifetime free AI messages for accounts without an active plan (never resets). Owners and subscribers are unlimited. */
export const AI_DAILY_LIMIT = 100;
const COUNT_TIMEOUT_MS = 2_500;
// One message = one user request. Chat turns are counted from leadtita_chat_turns (one row per turn, written
// before any model call); a turn's many model/tool calls are never counted. From ai_usage only features with a
// single model call per request are counted (people_planner: plan preview and each people search).
const COUNTED_FEATURES = ["contact_ai_fill", "people_planner"] as const;

type LimitUser = { id: string; role?: string };
export type AiDailyUsage = { used: number; limit: number; remaining: number; unlimited: boolean };

const UNLIMITED: AiDailyUsage = { used: 0, limit: AI_DAILY_LIMIT, remaining: Number.POSITIVE_INFINITY, unlimited: true };

async function countRecords(collection: string, filter: string, signal: AbortSignal) {
  const query = new URLSearchParams({ filter, perPage: "1", fields: "id" });
  const result = await pocketBaseFetch<{ totalItems?: number }>(`/api/collections/${collection}/records?${query}`, { signal });
  return typeof result.totalItems === "number" && result.totalItems > 0 ? result.totalItems : 0;
}

/** All-time AI messages for `user`. Fails open (unlimited) only when a lookup fails, and logs it. */
export async function checkAiDailyLimit(user: LimitUser): Promise<AiDailyUsage> {
  if (user.role === "owner") return UNLIMITED;
  const owner = `user = ${JSON.stringify(user.id)}`;
  const features = COUNTED_FEATURES.map((feature) => `feature = ${JSON.stringify(feature)}`).join(" || ");
  const signal = AbortSignal.timeout(COUNT_TIMEOUT_MS);
  const [plan, turns, calls] = await Promise.allSettled([
    hasActivePlan(user.id),
    countRecords("leadtita_chat_turns", owner, signal),
    countRecords("ai_usage", `${owner} && (${features})`, signal),
  ]);
  if (plan.status === "fulfilled" && plan.value) return UNLIMITED;
  if (turns.status === "rejected" || calls.status === "rejected") {
    const error = turns.status === "rejected" ? turns.reason : calls.status === "rejected" ? calls.reason : null;
    console.error("AI daily limit count failed; allowing request", error instanceof Error ? error.name : "unknown");
    return UNLIMITED;
  }
  const used = turns.value + calls.value;
  const remaining = Math.max(0, AI_DAILY_LIMIT - used);
  if (remaining === 0 && plan.status === "rejected") {
    // Can't confirm the plan: don't block a possible subscriber over a transient error.
    console.error("AI daily limit plan check failed; allowing request", plan.reason instanceof Error ? plan.reason.name : "unknown");
    return UNLIMITED;
  }
  return { used, limit: AI_DAILY_LIMIT, remaining, unlimited: false };
}

/**
 * Shared gate for AI endpoints, run after auth and before any model call: 10 requests/min per user in one bucket
 * across AI endpoints, then (unless `daily: false`) the free lifetime cap. Returns the 429 response, or null to proceed.
 */
export async function aiRequestLimit(user: LimitUser, t: Translator, options: { daily?: boolean } = {}) {
  if (rateLimited(`ai:${user.id}`, AI_RATE.max, AI_RATE.windowMs)) {
    return NextResponse.json(
      { error: t("aiRateLimited"), code: "ai_rate_limit" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(AI_RATE.windowMs / 1000)) } },
    );
  }
  if (options.daily === false) return null;
  const usage = await checkAiDailyLimit(user);
  if (usage.unlimited || usage.remaining > 0) return null;
  return NextResponse.json(
    { error: t("aiDailyLimit", { limit: usage.limit }), code: "ai_daily_limit", usage: { used: usage.used, limit: usage.limit } },
    { status: 429 },
  );
}
