import { pocketBaseFetch } from "@/lib/server/pocketbase";

// Lifetime caps for accounts without an active paid plan. Owners and subscribers are unlimited.
export const FREE_PAIN_ANALYSIS_LIMIT = 100;
export const FREE_ENRICHMENT_LIMIT = 100;

export type FreeUsageKind = "pain_points" | "enrichment";
type UsageUser = { id: string; role?: string };
type UsageRecord = { free_pain_analyses_used?: number; free_enrichments_used?: number };

const usageField = { pain_points: "free_pain_analyses_used", enrichment: "free_enrichments_used" } as const;
export const freeLimit = (kind: FreeUsageKind) => kind === "pain_points" ? FREE_PAIN_ANALYSIS_LIMIT : FREE_ENRICHMENT_LIMIT;

const count = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;

/** "Has a plan" = a subscription in status "authorized" (Mercado Pago's paid, active state). */
export async function hasActivePlan(userId: string) {
  const filter = encodeURIComponent(`user = "${userId}" && status = "authorized"`);
  const response = await pocketBaseFetch<{ totalItems: number }>(`/api/collections/subscriptions/records?perPage=1&fields=id&filter=${filter}`);
  return response.totalItems > 0;
}

export async function getFreeUsage(userId: string, kind: FreeUsageKind) {
  const user = await pocketBaseFetch<UsageRecord>(`/api/collections/users/records/${userId}?fields=${usageField[kind]}`);
  const used = count(user[usageField[kind]]);
  return { used, limit: freeLimit(kind), remaining: Math.max(0, freeLimit(kind) - used) };
}

async function adjustUsage(userId: string, kind: FreeUsageKind, delta: number) {
  // PocketBase "field+" / "field-" modifiers increment atomically on the server: no read-modify-write race.
  const key = `${usageField[kind]}${delta >= 0 ? "+" : "-"}`;
  const user = await pocketBaseFetch<UsageRecord>(`/api/collections/users/records/${userId}`, {
    method: "PATCH",
    body: JSON.stringify({ [key]: Math.abs(delta) }),
  });
  return count(user[usageField[kind]]);
}

export type FreeUsageReservation = {
  /** Items allowed to run; Infinity when the account is unlimited. */
  readonly granted: number;
  readonly unlimited: boolean;
  /** Keep the quota for `completed` items and return the rest. Idempotent. */
  settle(completed: number): Promise<void>;
};

/**
 * Reserve up to `requested` free analyses. Increments first (atomic), then gives back whatever pushed
 * the counter past the limit, so concurrent batches can only under-grant, never exceed the cap.
 */
export async function reserveFreeUsage(user: UsageUser, kind: FreeUsageKind, requested: number): Promise<FreeUsageReservation> {
  const unlimited: FreeUsageReservation = { granted: Infinity, unlimited: true, settle: async () => undefined };
  if (requested <= 0) return { granted: 0, unlimited: false, settle: async () => undefined };
  if (user.role === "owner") return unlimited;
  if (await hasActivePlan(user.id)) return unlimited;

  const { remaining } = await getFreeUsage(user.id, kind);
  let granted = Math.min(requested, remaining);
  if (granted > 0) {
    const after = await adjustUsage(user.id, kind, granted);
    const excess = Math.min(granted, Math.max(0, after - freeLimit(kind)));
    if (excess > 0) {
      await adjustUsage(user.id, kind, -excess);
      granted -= excess;
    }
  }
  let settled = false;
  return {
    granted,
    unlimited: false,
    async settle(completed: number) {
      if (settled) return;
      settled = true;
      const refund = granted - Math.min(granted, Math.max(0, Number.isFinite(completed) ? completed : 0));
      if (refund > 0) await adjustUsage(user.id, kind, -refund);
    },
  };
}
