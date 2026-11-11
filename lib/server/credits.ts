import { pocketBaseFetch } from "@/lib/server/pocketbase";

export const CREDITS_PER_LEAD = 2;
export const CREDITS_PER_PAIN_ANALYSIS = 0.5;
const staleLockMilliseconds = 15 * 60 * 1000;

type CreditUserRecord = { id: string; credits?: number };
type CreditLockRecord = { id: string; created?: string };

export class InsufficientCreditsError extends Error {
  constructor(readonly available: number, readonly required: number) {
    super(`Insufficient credits: ${required} required, ${available} available.`);
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

    credits -= requestedCredits;
    await pocketBaseFetch(`/api/collections/users/records/${userId}`, {
      method: "PATCH",
      body: JSON.stringify({ credits }),
    });
  } catch (error) {
    await pocketBaseFetch(`/api/collections/credit_locks/records/${lock.id}`, { method: "DELETE" }).catch(() => undefined);
    throw error;
  }

  return {
    get balance() {
      return credits;
    },
    async settle(chargedAmount: number) {
      if (settled) return credits;
      const chargedCredits = Math.min(requestedCredits, Math.max(0, Number.isFinite(chargedAmount) ? chargedAmount : 0));
      const refund = requestedCredits - chargedCredits;
      if (refund > 0) {
        const refundedBalance = credits + refund;
        await pocketBaseFetch(`/api/collections/users/records/${userId}`, {
          method: "PATCH",
          body: JSON.stringify({ credits: refundedBalance }),
        });
        credits = refundedBalance;
      }
      settled = true;
      return credits;
    },
    async release() {
      if (!settled) await this.settle(0);
      await pocketBaseFetch(`/api/collections/credit_locks/records/${lock.id}`, { method: "DELETE" });
    },
  };
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
