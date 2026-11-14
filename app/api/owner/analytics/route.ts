import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/server/owner";
import { CREDITS_PER_LEAD } from "@/lib/server/credits";
import { CREDITS_PER_PERSON } from "@/lib/people";
import { PocketBaseRequestError } from "@/lib/server/pocketbase";
import { countRecords, filterString, listAllRecords, listRecords, pocketBaseDate, pocketBaseNotReady } from "../_shared";
import { errorTranslator } from "@/lib/server/locale";

const dayMs = 24 * 60 * 60 * 1000;
const allowedDays = [7, 30, 90] as const;
const postHogTimeoutMs = 8_000;

type Days = typeof allowedDays[number];
type BatchRow = { kind?: string; result_count?: number };
type AiRow = { feature: string; model?: string; user?: string; cost_usd?: number; prompt_tokens?: number; completion_tokens?: number; created_at: string };
type Feature = { id: string; count: number; units?: number; credits?: number; usd?: number };

function parseDays(value: string | null): Days | null {
  if (value === null || value === "") return 30;
  const parsed = Number(value);
  return allowedDays.find((days) => days === parsed) ?? null;
}

/** YYYY-MM-DD keys (UTC) for every day of the period, oldest first. */
function dayKeys(days: number) {
  const today = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
  return Array.from({ length: days }, (_, index) => new Date(today - (days - 1 - index) * dayMs).toISOString().slice(0, 10));
}

const isMissingCollection = (error: unknown) => error instanceof PocketBaseRequestError && (error.status === 404 || error.status === 400);
const round = (value: number, digits = 6) => Math.round(value * 10 ** digits) / 10 ** digits;

async function postHogQuery(host: string, projectId: string, key: string, query: string) {
  const response = await fetch(`${host}/api/projects/${encodeURIComponent(projectId)}/query/`, {
    method: "POST",
    cache: "no-store",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
    signal: AbortSignal.timeout(postHogTimeoutMs),
  });
  if (!response.ok) throw new Error(`PostHog responded ${response.status}`);
  const data = (await response.json()) as { results?: unknown[][] };
  return Array.isArray(data.results) ? data.results : [];
}

async function loadTraffic(days: Days) {
  const key = process.env.POSTHOG_PERSONAL_API_KEY;
  const projectId = process.env.POSTHOG_PROJECT_ID;
  if (!key || !projectId) return { configured: false as const };
  const host = (process.env.POSTHOG_API_HOST || "https://us.posthog.com").replace(/\/+$/, "");
  // `days` is validated against a fixed allow-list, so interpolating it is safe.
  const where = `event = '$pageview' AND timestamp >= now() - INTERVAL ${days} DAY`;
  try {
    const [daily, totals, pages, referrers] = await Promise.all([
      postHogQuery(host, projectId, key, `SELECT toString(toDate(timestamp)) AS day, count() AS pageviews, count(DISTINCT person_id) AS visitors FROM events WHERE ${where} GROUP BY day ORDER BY day`),
      postHogQuery(host, projectId, key, `SELECT count() AS pageviews, count(DISTINCT person_id) AS visitors FROM events WHERE ${where}`),
      postHogQuery(host, projectId, key, `SELECT properties.$pathname AS path, count() AS pageviews, count(DISTINCT person_id) AS visitors FROM events WHERE ${where} GROUP BY path ORDER BY pageviews DESC LIMIT 10`),
      postHogQuery(host, projectId, key, `SELECT properties.$referring_domain AS domain, count(DISTINCT person_id) AS visitors FROM events WHERE ${where} AND isNotNull(properties.$referring_domain) GROUP BY domain ORDER BY visitors DESC LIMIT 10`),
    ]);
    const byDay = new Map(daily.map((row) => [String(row[0]), { pageviews: Number(row[1]) || 0, visitors: Number(row[2]) || 0 }]));
    return {
      configured: true as const,
      totals: { pageviews: Number(totals[0]?.[0]) || 0, visitors: Number(totals[0]?.[1]) || 0 },
      daily: dayKeys(days).map((date) => ({ date, ...(byDay.get(date) ?? { pageviews: 0, visitors: 0 }) })),
      topPages: pages.map((row) => ({ path: String(row[0] ?? "") || "/", pageviews: Number(row[1]) || 0, visitors: Number(row[2]) || 0 })),
      referrers: referrers.map((row) => ({ domain: String(row[0] ?? ""), visitors: Number(row[1]) || 0 })).filter((row) => row.domain),
    };
  } catch (error) {
    console.error("Owner analytics PostHog failed:", error instanceof Error ? error.name : "unknown");
    return { configured: true as const, error: true as const };
  }
}

async function loadAi(days: Days, since: string) {
  let rows: AiRow[];
  try {
    rows = await listAllRecords<AiRow>("ai_usage", {
      filter: `created_at >= ${since}`,
      fields: "feature,model,user,cost_usd,prompt_tokens,completion_tokens,created_at",
    });
  } catch (error) {
    if (isMissingCollection(error)) return { available: false as const };
    throw error;
  }

  const perDay = new Map(dayKeys(days).map((date) => [date, { usd: 0, calls: 0 }]));
  const byFeature = new Map<string, { feature: string; usd: number; calls: number }>();
  const byModel = new Map<string, { model: string; usd: number; calls: number }>();
  const byUser = new Map<string, { userId: string; usd: number; calls: number }>();
  let totalUsd = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  for (const row of rows) {
    const usd = Number(row.cost_usd) || 0;
    totalUsd += usd;
    promptTokens += Number(row.prompt_tokens) || 0;
    completionTokens += Number(row.completion_tokens) || 0;
    const day = perDay.get(String(row.created_at).slice(0, 10));
    if (day) { day.usd += usd; day.calls++; }
    const feature = byFeature.get(row.feature) ?? { feature: row.feature, usd: 0, calls: 0 };
    feature.usd += usd; feature.calls++;
    byFeature.set(row.feature, feature);
    const modelName = row.model || "unknown";
    const model = byModel.get(modelName) ?? { model: modelName, usd: 0, calls: 0 };
    model.usd += usd; model.calls++;
    byModel.set(modelName, model);
    if (row.user) {
      const user = byUser.get(row.user) ?? { userId: row.user, usd: 0, calls: 0 };
      user.usd += usd; user.calls++;
      byUser.set(row.user, user);
    }
  }

  const topUsers = [...byUser.values()].sort((a, b) => b.usd - a.usd || b.calls - a.calls).slice(0, 10);
  // One bounded lookup for the emails of the top users (no per-row requests).
  const emails = new Map<string, string>();
  if (topUsers.length > 0) {
    const users = await listRecords<{ id: string; email: string }>("users", {
      perPage: topUsers.length,
      skipTotal: 1,
      fields: "id,email",
      filter: topUsers.map((user) => `id = ${filterString(user.userId)}`).join(" || "),
    }).catch(() => null);
    for (const user of users?.items ?? []) emails.set(user.id, user.email);
  }

  const bySpend = <T extends { usd: number; calls: number }>(items: Iterable<T>) => [...items].sort((a, b) => b.usd - a.usd || b.calls - a.calls).map((item) => ({ ...item, usd: round(item.usd) }));
  return {
    available: true as const,
    totalUsd: round(totalUsd),
    calls: rows.length,
    promptTokens,
    completionTokens,
    daily: [...perDay.entries()].map(([date, value]) => ({ date, usd: round(value.usd), calls: value.calls })),
    byFeature: bySpend(byFeature.values()),
    byModel: bySpend(byModel.values()),
    topUsers: topUsers.map((user) => ({ ...user, usd: round(user.usd), email: emails.get(user.userId) ?? "" })),
  };
}

/** Optional collection count: null when the collection doesn't exist on this deployment. */
const optionalCount = (collection: string, filter: string) => countRecords(collection, filter).catch((error) => {
  if (isMissingCollection(error)) return null;
  throw error;
});

/** Owner analytics for the last `days` days: traffic (PostHog), feature usage and credits (PocketBase), AI spend (ai_usage). Read-only. */
export async function GET(request: Request) {
  const t = errorTranslator(request);
  const denied = (await requireOwner(request)) ?? pocketBaseNotReady(request);
  if (denied) return denied;

  const days = parseDays(new URL(request.url).searchParams.get("days"));
  if (days === null) return NextResponse.json({ error: t("ownerInvalidData") }, { status: 400 });

  const since = `"${pocketBaseDate(new Date(Date.now() - days * dayMs))}"`;
  try {
    // Independent sources in parallel; PostHog failures never fail the response.
    const [traffic, ai, batches, contacts, reports, googleConnections, referrals, newUsers] = await Promise.all([
      loadTraffic(days),
      loadAi(days, since),
      listAllRecords<BatchRow>("lead_batches", { filter: `created_at >= ${since}`, fields: "kind,result_count" }),
      optionalCount("lead_contacts", `created >= ${since}`),
      optionalCount("lead_suite_reports", `created >= ${since}`),
      optionalCount("google_connections", `created >= ${since}`),
      optionalCount("referrals", `created >= ${since}`),
      countRecords("users", `created >= ${since}`),
    ]);

    const business = { id: "business_search", count: 0, units: 0, credits: 0 };
    const people = { id: "people_search", count: 0, units: 0, credits: 0 };
    for (const batch of batches) {
      const delivered = Number(batch.result_count) || 0;
      const target = batch.kind === "person" ? people : business;
      target.count++;
      target.units += delivered;
      target.credits += delivered * (batch.kind === "person" ? CREDITS_PER_PERSON : CREDITS_PER_LEAD);
    }

    const features: Feature[] = [business, people, { id: "signups", count: newUsers }];
    const optional: [string, number | null][] = [["lead_contacts", contacts], ["weekly_reports", reports], ["google_connections", googleConnections], ["referrals", referrals]];
    for (const [id, count] of optional) if (count !== null) features.push({ id, count });
    if (ai.available) for (const row of ai.byFeature) features.push({ id: `ai.${row.feature}`, count: row.calls, usd: row.usd });
    features.sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));

    return NextResponse.json({
      days,
      generatedAt: new Date().toISOString(),
      traffic,
      features,
      credits: {
        total: business.credits + people.credits,
        byFeature: [
          { id: "business_search", credits: business.credits, units: business.units },
          { id: "people_search", credits: people.credits, units: people.units },
        ],
      },
      ai,
    });
  } catch (error) {
    console.error("Owner analytics failed:", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ error: t("ownerMetricsFailed") }, { status: 502 });
  }
}
