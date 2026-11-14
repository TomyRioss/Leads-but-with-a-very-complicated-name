import { pocketBaseFetch } from "@/lib/server/pocketbase";

export const CREDITS_PER_LEAD = 2;
// El análisis de dolores es gratis: no se reservan ni cobran créditos.
export const CREDITS_PER_PAIN_ANALYSIS = 0;
const staleLockMilliseconds = 15 * 60 * 1000;

type CreditUserRecord = { id: string; credits?: number };
type CreditLockRecord = { id: string; created?: string };

export class InsufficientCreditsError extends Error {
  // Plain fields (no parameter properties) so the file runs under node --experimental-strip-types.
  readonly available: number;
  readonly required: number;
  constructor(available: number, required: number) {
    super(`Insufficient credits: ${required} required, ${available} available.`);
    this.available = available;
    this.required = required;
    this.name = "InsufficientCreditsError";
  }
}

export class CreditOperationBusyError extends Error {
  constructor() {
    super("A credit operation is already in progress for this account.");
    this.name = "CreditOperationBusyError";
  }
}

async function findUserLock(userId: string) {
  const filter = encodeURIComponent(`user = "${userId}"`);
  const response = await pocketBaseFetch<{ items: CreditLockRecord[] }>(
    `/api/collections/credit_locks/records?perPage=1&filter=${filter}`,
  );
  return response.items[0] || null;
}

async function acquireLock(userId: string) {
  const create = () => pocketBaseFetch<CreditLockRecord>("/api/collections/credit_locks/records", {
    method: "POST",
    body: JSON.stringify({ user: userId }),
  });

  try {
    return await create();
  } catch {
    const existing = await findUserLock(userId).catch(() => null);
    if (!existing) throw new Error("Couldn't reserve the credit operation.");
    const createdAt = Date.parse(existing.created || "");
    if (!Number.isFinite(createdAt) || Date.now() - createdAt < staleLockMilliseconds) {
      throw new CreditOperationBusyError();
    }

    await pocketBaseFetch(`/api/collections/credit_locks/records/${existing.id}`, { method: "DELETE" });
    try {
      return await create();
    } catch {
      throw new CreditOperationBusyError();
    }
  }
}

/** Atomic relative PATCH; returns the stored balance (falls back to `expected` if the response omits it). */
export async function adjustCredits(userId: string, delta: number, expected: number) {
  if (delta === 0) return expected;
  const record = await pocketBaseFetch<CreditUserRecord>(`/api/collections/users/records/${userId}`, {
    method: "PATCH",
    body: JSON.stringify(delta > 0 ? { "credits+": delta } : { "credits-": -delta }),
  });
  return typeof record?.credits === "number" && Number.isFinite(record.credits) ? record.credits : expected;
}

export async function reserveCreditAmount(userId: string, requestedCredits: number) {
  if (!Number.isFinite(requestedCredits) || requestedCredits < 0) throw new Error("Invalid credit amount.");
  const lock = await acquireLock(userId);
  let credits = 0;
  let settled = false;

  try {
    const user = await pocketBaseFetch<CreditUserRecord>(`/api/collections/users/records/${userId}`);
    credits = typeof user.credits === "number" && Number.isFinite(user.credits) && user.credits >= 0
      ? user.credits
      : 0;
    if (credits < requestedCredits) throw new InsufficientCreditsError(credits, requestedCredits);

    // Relative writes ("credits-"/"credits+"): lock-free increments (e.g. referral rewards) landing mid-operation are not overwritten.
    credits = await adjustCredits(userId, -requestedCredits, credits - requestedCredits);
  } catch (error) {
    await pocketBaseFetch(`/api/collections/credit_locks/records/${lock.id}`, { method: "DELETE" }).catch(() => undefined);
    throw error;
  }

  const reservation = {
    get balance() {
      return credits;
    },
    async settle(chargedAmount: number) {
      if (settled) return credits;
      const { refund } = settleCredits(requestedCredits, chargedAmount);
      if (refund > 0) {
        credits = await adjustCredits(userId, refund, credits + refund);
      }
      settled = true;
      return credits;
    },
    // Unsettled at release = nothing delivered: full refund. The lock is always freed, even if the refund fails.
    async release() {
      try {
        if (!settled) await reservation.settle(0);
      } finally {
        await pocketBaseFetch(`/api/collections/credit_locks/records/${lock.id}`, { method: "DELETE" });
      }
    },
  };
  return reservation;
}

/** Pure split of a reservation: charge what was delivered (clamped to [0, reserved]), refund the rest. */
export function settleCredits(reservedCredits: number, deliveredCredits: number) {
  const charged = Math.min(reservedCredits, Math.max(0, Number.isFinite(deliveredCredits) ? deliveredCredits : 0));
  return { charged, refund: reservedCredits - charged };
}

export async function reserveLeadCredits(userId: string, leadCount: number) {
  const reservation = await reserveCreditAmount(userId, leadCount * CREDITS_PER_LEAD);
  return {
    get balance() {
      return reservation.balance;
    },
    settle(persistedLeads: number) {
      const chargedLeads = Math.min(leadCount, Math.max(0, Number.isFinite(persistedLeads) ? persistedLeads : 0));
      return reservation.settle(chargedLeads * CREDITS_PER_LEAD);
    },
    release: reservation.release,
  };
}
