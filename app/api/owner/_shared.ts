import { NextResponse } from "next/server";
import { errorTranslator } from "@/lib/server/locale";
import { isPocketBaseConfigured, pocketBaseFetch } from "@/lib/server/pocketbase";

export const activeSubscriptionStatuses = ["authorized", "paused", "pending"] as const;
export const maxCredits = 1_000_000;

const recordIdPattern = /^[A-Za-z0-9]{1,30}$/;
const maxPages = 500;

export type UserRecord = { id: string; email: string; name?: string; credits?: number; created: string; phone?: string; role?: string };
export type SubscriptionRecord = {
  id: string;
  user: string;
  plan_id: string;
  external_reference: string;
  status: string;
  price_ars: number;
  monthly_credits: number;
  created: string;
};
export type PaymentRecord = {
  id: string;
  payment_id: string;
  status: string;
  amount_ars: number;
  credits: number;
  created: string;
};
type ListResponse<T> = { items: T[]; page: number; totalPages: number; totalItems: number };

export function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

/** Parses the JSON body, returning null unless it is a plain object (rejects null, arrays and primitives). */
export async function readJsonObject(request: Request) {
  try {
    const body: unknown = await request.json();
    return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function pocketBaseNotReady(request: Request) {
  return isPocketBaseConfigured() ? null : errorResponse(errorTranslator(request)("ownerPocketbaseNotReady"), 503);
}

export function isValidRecordId(id: string) {
  return recordIdPattern.test(id);
}

/** Escapes a value for use inside a double-quoted PocketBase filter string. */
export function filterString(value: string) {
  return `"${value.replace(/[\\"]/g, "\\$&")}"`;
}

export function pocketBaseDate(date: Date) {
  return date.toISOString().replace("T", " ");
}

export function isNotFound(error: unknown) {
  return error instanceof Error && error.message.includes("PocketBase responded 404");
}

export async function listRecords<T>(collection: string, params: Record<string, string | number>) {
  const query = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)]));
  return pocketBaseFetch<ListResponse<T>>(`/api/collections/${collection}/records?${query}`);
}

/** Reads every page (perPage 200, capped) of a filtered collection. */
export async function listAllRecords<T>(collection: string, params: Record<string, string>) {
  const perPage = 200;
  const first = await listRecords<T>(collection, { ...params, perPage, page: 1 });
  const items = [...first.items];
  for (let page = 2; page <= Math.min(first.totalPages, maxPages); page++) {
    items.push(...(await listRecords<T>(collection, { ...params, perPage, page })).items);
  }
  return items;
}

export function normalizeCredits(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

export function toSubscriptionSummary(subscription: SubscriptionRecord) {
  return {
    id: subscription.id,
    planId: subscription.plan_id,
    status: subscription.status,
    priceArs: subscription.price_ars,
    monthlyCredits: subscription.monthly_credits,
  };
}

type CreditLock = { id: string; created?: string };
const staleLockMilliseconds = 15 * 60 * 1000;

export class OwnerCreditsBusyError extends Error {
  constructor() {
    super("A credit operation is already in progress for this user.");
    this.name = "OwnerCreditsBusyError";
  }
}

async function acquireCreditLock(userId: string) {
  const create = () => pocketBaseFetch<CreditLock>("/api/collections/credit_locks/records", {
    method: "POST",
    body: JSON.stringify({ user: userId }),
  });
  try {
    return await create();
  } catch {
    const existing = (await listRecords<CreditLock>("credit_locks", {
      perPage: 1,
      filter: `user = ${filterString(userId)}`,
    }).catch(() => null))?.items[0];
    if (!existing) throw new Error("Couldn't reserve the credit operation.");
    const createdAt = Date.parse(existing.created || "");
    if (!Number.isFinite(createdAt) || Date.now() - createdAt < staleLockMilliseconds) throw new OwnerCreditsBusyError();
    await pocketBaseFetch(`/api/collections/credit_locks/records/${existing.id}`, { method: "DELETE" });
    try {
      return await create();
    } catch {
      throw new OwnerCreditsBusyError();
    }
  }
}

async function releaseCreditLock(lockId: string) {
  const remove = () => pocketBaseFetch(`/api/collections/credit_locks/records/${lockId}`, { method: "DELETE" });
  try {
    await remove();
  } catch {
    try {
      await remove();
    } catch (error) {
      // A leftover lock expires after 15 minutes (see acquireCreditLock).
      console.error("Owner credit lock release failed:", error instanceof Error ? error.name : "unknown");
    }
  }
}

/**
 * Computes the new balance under the shared `credit_locks` lock so an in-flight search is not overwritten.
 * `compute` returns the new balance, or null to abort (nothing is written).
 */
export async function updateUserCredits(userId: string, compute: (current: number) => number | null) {
  const lock = await acquireCreditLock(userId);
  try {
    const user = await pocketBaseFetch<{ credits?: number }>(`/api/collections/users/records/${userId}?fields=credits`);
    const next = compute(normalizeCredits(user.credits));
    if (next === null) return null;
    await pocketBaseFetch(`/api/collections/users/records/${userId}`, {
      method: "PATCH",
      body: JSON.stringify({ credits: next }),
    });
    return next;
  } finally {
    await releaseCreditLock(lock.id);
  }
}

export type UserSummary = { id: string; email: string; name?: string; role?: string; phone?: string };

/** Loads the identity fields of a user, or null when it does not exist. */
export async function findUserSummary(id: string) {
  const result = await listRecords<UserSummary>("users", { perPage: 1, filter: `id = ${filterString(id)}`, fields: "id,email,name,role,phone" });
  return result.items[0] ?? null;
}

export async function countRecords(collection: string, filter: string) {
  return (await listRecords(collection, { perPage: 1, filter, fields: "id" })).totalItems;
}
