import { pocketBaseFetch } from "@/lib/server/pocketbase";
import { getPlanLimits } from "@/lib/server/usage-limits";

export const GMAIL_DAILY_LIMIT = 40;
const TIME_ZONE = "America/Argentina/Buenos_Aires";
type UsageRecord = { id: string; used?: number };
type UsageList = { items: UsageRecord[] };

function todayInBuenosAires() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

const filterFor = (userId: string, day: string) => `user = ${JSON.stringify(userId)} && day = ${JSON.stringify(day)}`;

async function findUsage(userId: string, day: string) {
  const params = new URLSearchParams({ filter: filterFor(userId, day), fields: "id,used", perPage: "1", skipTotal: "1" });
  const result = await pocketBaseFetch<UsageList>(`/api/collections/gmail_daily_usage/records?${params}`);
  return result.items[0] ?? null;
}

async function getOrCreateUsage(userId: string, day: string) {
  const existing = await findUsage(userId, day);
  if (existing) return existing;

  try {
    return await pocketBaseFetch<UsageRecord>("/api/collections/gmail_daily_usage/records", {
      method: "POST",
      body: JSON.stringify({ user: userId, day, used: 0 }),
    });
  } catch (error) {
    // Another request may have created the unique user/day row first.
    const raced = await findUsage(userId, day);
    if (raced) return raced;
    throw error;
  }
}

async function adjustUsage(recordId: string, delta: number) {
  const key = `used${delta >= 0 ? "+" : "-"}`;
  const record = await pocketBaseFetch<UsageRecord>(`/api/collections/gmail_daily_usage/records/${recordId}`, {
    method: "PATCH",
    body: JSON.stringify({ [key]: Math.abs(delta) }),
  });
  return typeof record.used === "number" && Number.isFinite(record.used) ? Math.max(0, record.used) : 0;
}

export type GmailDailyReservation = {
  readonly granted: number;
  settle(completed: number): Promise<void>;
};

export async function getGmailDailyUsage(userId: string) {
  const usage = await findUsage(userId, todayInBuenosAires());
  const used = typeof usage?.used === "number" && Number.isFinite(usage.used) ? Math.max(0, usage.used) : 0;
  return { used: Math.min(GMAIL_DAILY_LIMIT, used), limit: GMAIL_DAILY_LIMIT };
}

/** Emails sent this Buenos Aires month: sum of this month's daily rows (≤31). */
async function monthUsed(userId: string, day: string) {
  const params = new URLSearchParams({ filter: `user = ${JSON.stringify(userId)} && day >= ${JSON.stringify(`${day.slice(0, 7)}-01`)}`, fields: "used", perPage: "31", skipTotal: "1" });
  const result = await pocketBaseFetch<UsageList>(`/api/collections/gmail_daily_usage/records?${params}`);
  return result.items.reduce((sum, item) => sum + (typeof item.used === "number" && Number.isFinite(item.used) ? Math.max(0, item.used) : 0), 0);
}

/**
 * Reserves capacity atomically against the daily cap, trimmed to the plan's monthly cap; refunds failed or unused slots.
 * ponytail: the monthly check is read-then-reserve; concurrent batches can overshoot it by one batch (≤10).
 */
export async function reserveGmailDailyUsage(userId: string, requested: number): Promise<GmailDailyReservation> {
  const day = todayInBuenosAires();
  const { emailMonthly } = await getPlanLimits(userId);
  const monthlyLeft = Number.isFinite(emailMonthly) ? Math.max(0, emailMonthly - await monthUsed(userId, day)) : Infinity;
  const count = Math.max(0, Math.min(GMAIL_DAILY_LIMIT, monthlyLeft, Math.trunc(requested)));
  if (!count) return { granted: 0, settle: async () => undefined };

  const usage = await getOrCreateUsage(userId, day);
  const after = await adjustUsage(usage.id, count);
  const excess = Math.min(count, Math.max(0, after - GMAIL_DAILY_LIMIT));
  if (excess) await adjustUsage(usage.id, -excess);
  const granted = count - excess;

  let settled = false;
  return {
    granted,
    async settle(completed) {
      if (settled) return;
      settled = true;
      const kept = Math.min(granted, Math.max(0, Number.isFinite(completed) ? Math.trunc(completed) : 0));
      const refund = granted - kept;
      if (refund) await adjustUsage(usage.id, -refund);
    },
  };
}
