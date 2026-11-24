import { createHmac, timingSafeEqual } from "node:crypto";
import type { Plan } from "@/lib/plans";

// Rebill REST client (subscriptions are created by the checkout widget; the server only reads, cancels and verifies).
// Plain fetch, no SDK. Sandbox and production share this host: the key decides (test keys act on the sandbox org).
// Docs: https://docs.rebill.com

const API = "https://api.rebill.com";
const TIMEOUT_MS = 10_000;

export class RebillError extends Error {
  readonly status: number;
  constructor(status: number, path: string) {
    super(`Rebill ${path.split("/")[2] ?? "request"} failed with ${status}.`);
    this.name = "RebillError";
    this.status = status;
  }
}

const secretKey = () => process.env.REBILL_SECRET_KEY?.trim() ?? "";
const webhookSecret = () => process.env.REBILL_WEBHOOK_SECRET?.trim() ?? "";
export const rebillPublicKey = () => process.env.REBILL_PUBLIC_KEY?.trim() ?? "";
export const isRebillConfigured = () => Boolean(secretKey() && rebillPublicKey() && webhookSecret());

/** REBILL_PLAN_IDS="starter=pln_x,growth=pln_y": leadta plan id → Rebill plan id (differs between sandbox and production). */
export function rebillPlanIds(): Record<string, string> {
  const pairs = (process.env.REBILL_PLAN_IDS ?? "").split(",").map((pair) => pair.trim().split("=", 2) as [string, string | undefined]);
  return Object.fromEntries(pairs.filter(([id, rebillId]) => id && rebillId).map(([id, rebillId]) => [id, rebillId!.trim()]));
}

/** Leadta plan id for a Rebill plan id, or undefined when it isn't one of ours. */
export const leadtaPlanId = (rebillPlanId: string) => Object.entries(rebillPlanIds()).find(([, value]) => value === rebillPlanId)?.[0];

export type RebillSubscription = { id?: string; status?: string; planId?: string; plan?: { id?: string }; customer?: { email?: string } };
export type RebillPayment = { id?: string; status?: string; subscriptionId?: string; subscription?: { id?: string } };

async function rebill<T>(path: string, init: { method?: "GET" | "PATCH"; body?: unknown; revalidate?: number } = {}): Promise<T> {
  const key = secretKey();
  if (!key) throw new RebillError(503, path);
  const response = await fetch(`${API}${path}`, {
    method: init.method ?? "GET",
    headers: { "x-api-key": key, "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    ...(init.revalidate ? { next: { revalidate: init.revalidate } } : { cache: "no-store" as const }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new RebillError(response.status, path);
  return response.json() as Promise<T>;
}

const id = (value: string) => encodeURIComponent(value);
export const getSubscription = (subscriptionId: string) => rebill<RebillSubscription>(`/v3/subscriptions/${id(subscriptionId)}`);
export const getPayment = (paymentId: string) => rebill<RebillPayment>(`/v3/payments/${id(paymentId)}`);
export const updateSubscription = (subscriptionId: string, body: { status: "cancelled" | "paused" | "active"; nextChargeDate?: string }) =>
  rebill<RebillSubscription>(`/v3/subscriptions/${id(subscriptionId)}`, { method: "PATCH", body });

/** Prices configured in Rebill, by leadta plan id and currency (cached 1h). A plan that fails to load is just empty: callers fall back to the catalog. */
export async function getPlanPrices(): Promise<Record<string, Record<string, number>>> {
  const entries = await Promise.all(Object.entries(rebillPlanIds()).map(async ([planId, rebillId]) => {
    const plan = await rebill<{ prices?: { currency: string; amount: number }[] }>(`/v3/plans/${id(rebillId)}`, { revalidate: 3600 }).catch(() => null);
    return [planId, Object.fromEntries((plan?.prices ?? []).map(({ currency, amount }) => [currency, amount]))] as const;
  }));
  return Object.fromEntries(entries);
}

/** Price to show a visitor: Rebill's amount in their currency, else the catalog's ARS/USD, else USD. */
export function displayPrice(prices: Awaited<ReturnType<typeof getPlanPrices>>, plan: Plan, currency: string) {
  const amounts: Record<string, number> = { ARS: plan.priceArs, USD: plan.priceUsd, ...prices[plan.id] };
  const code = currency in amounts ? currency : "USD";
  return { amount: amounts[code], currency: code };
}

/** Rebill status → stored status. Retrying keeps access (4 retries, then Rebill pauses it); cancelled and finished are terminal. */
export function toStoredStatus(status: string | undefined) {
  if (status === "active" || status === "retrying") return "authorized";
  if (status === "paused") return "paused";
  if (status === "cancelled" || status === "finished") return "canceled";
  return "pending";
}

/** x-rebill-signature: lowercase hex HMAC-SHA256 of the raw body, keyed with the webhook signing secret. */
export function isValidWebhookSignature(signature: string, rawBody: string, secret = webhookSecret()) {
  if (!secret || !signature) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(rawBody).digest("hex"));
  const received = Buffer.from(signature.trim().toLowerCase());
  return expected.length === received.length && timingSafeEqual(expected, received);
}
