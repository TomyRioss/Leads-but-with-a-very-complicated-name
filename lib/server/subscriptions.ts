import { randomUUID } from "node:crypto";
import { findPlan, plansForUser, subscriptionPlans } from "@/lib/plans";
import { sendSubscriptionReceiptEmail } from "@/lib/server/email";
import { PocketBaseRequestError, pocketBaseFetch } from "@/lib/server/pocketbase";
import {
  getPayment,
  getSubscription,
  isRebillConfigured,
  leadtaPlanId,
  RebillError,
  rebillPlanIds,
  rebillPublicKey,
  toStoredStatus,
  updateSubscription,
} from "@/lib/server/rebill";

// Paid plans through Rebill (checkout widget, monthly). PocketBase `subscriptions` mirrors Rebill; the webhook keeps the
// status in sync and credits each approved charge once (`subscription_payments.payment_id` is unique).

type SubscriptionRow = {
  id: string;
  user: string;
  plan_id: string;
  external_reference: string;
  rebill_subscription_id?: string;
  status: string;
  price_ars: number;
  monthly_credits: number;
};

export type CurrentSubscription = { id: string; planId: string; planName: string; status: string; priceArs: number; monthlyCredits: number };

export class SubscriptionError extends Error {
  readonly code: "invalid_plan" | "already_subscribed" | "not_configured" | "not_found" | "invalid_subscription" | "forbidden" | "rebill";
  constructor(code: SubscriptionError["code"]) { super(code); this.code = code; this.name = "SubscriptionError"; }
}

const RECORDS = "/api/collections/subscriptions/records";
/** Statuses that still bind the user to a plan (charging, paused or processing the first charge). */
const LIVE = ["authorized", "paused", "pending"];
const q = (value: string) => JSON.stringify(value);
const rec = (value: unknown): Record<string, unknown> => (value && typeof value === "object" ? (value as Record<string, unknown>) : {});
const str = (value: unknown) => (typeof value === "string" ? value : "");

async function findOne(collection: string, filter: string) {
  const params = new URLSearchParams({ filter, perPage: "1", skipTotal: "1", sort: "-created" });
  return (await pocketBaseFetch<{ items: SubscriptionRow[] }>(`/api/collections/${collection}/records?${params}`)).items[0] ?? null;
}
const byRebillId = (rebillId: string) => findOne("subscriptions", `rebill_subscription_id = ${q(rebillId)}`);

async function liveSubscriptions(userId: string) {
  const params = new URLSearchParams({ filter: `user = ${q(userId)} && (${LIVE.map((s) => `status = ${q(s)}`).join(" || ")})`, perPage: "20", skipTotal: "1", sort: "-created" });
  return (await pocketBaseFetch<{ items: SubscriptionRow[] }>(`${RECORDS}?${params}`)).items;
}

const patch = (id: string, body: Record<string, unknown>) =>
  pocketBaseFetch(`${RECORDS}/${id}`, { method: "PATCH", body: JSON.stringify(body) });

/** Newest live subscription of the user, or null. */
export async function getCurrentSubscription(userId: string): Promise<CurrentSubscription | null> {
  const row = (await liveSubscriptions(userId))[0];
  if (!row) return null;
  return {
    id: row.id,
    planId: row.plan_id,
    planName: findPlan(subscriptionPlans, row.plan_id)?.name ?? row.plan_id,
    status: row.status,
    priceArs: row.price_ars,
    monthlyCredits: row.monthly_credits,
  };
}

/** Cancels in Rebill (already cancelled / unknown there counts as done), then stores "canceled". */
async function cancelRow(row: SubscriptionRow) {
  if (row.rebill_subscription_id) {
    try {
      await updateSubscription(row.rebill_subscription_id, { status: "cancelled" });
    } catch (error) {
      const remote = await getSubscription(row.rebill_subscription_id).catch((lookup) => (lookup instanceof RebillError && lookup.status === 404 ? { status: "cancelled" } : null));
      if (toStoredStatus(remote?.status) !== "canceled") throw error;
    }
  }
  await patch(row.id, { status: "canceled" });
}

/**
 * Validates the plan for the widget. Nothing is stored yet: the subscription row is created when Rebill reports the
 * subscription (webhook or confirm). Returns what the browser needs to render the checkout.
 */
export async function startCheckout(user: { id: string; email: string }, planId: string) {
  const plan = plansForUser(subscriptionPlans, user.id).find((item) => item.id === planId);
  const rebillPlanId = rebillPlanIds()[planId];
  if (!plan) throw new SubscriptionError("invalid_plan");
  if (!isRebillConfigured() || !rebillPlanId) throw new SubscriptionError("not_configured");
  if ((await liveSubscriptions(user.id)).length) throw new SubscriptionError("already_subscribed");
  return { publicKey: rebillPublicKey(), rebillPlanId, email: user.email };
}

/** Creates the row for a Rebill subscription. A concurrent creator wins on the unique index: its row is returned. */
async function createRow(userId: string, plan: { id: string; priceArs: number; credits: number }, rebillId: string, status: string) {
  try {
    return await pocketBaseFetch<SubscriptionRow>(RECORDS, {
      method: "POST",
      body: JSON.stringify({ user: userId, plan_id: plan.id, external_reference: `leadta_${randomUUID()}`, rebill_subscription_id: rebillId, status, price_ars: plan.priceArs, monthly_credits: plan.credits }),
    });
  } catch (error) {
    if (error instanceof PocketBaseRequestError && error.status === 400) {
      const existing = await byRebillId(rebillId);
      if (existing) return existing;
    }
    throw error;
  }
}

/**
 * Links a Rebill subscription to the signed-in user (called by the browser right after the widget reports success, so
 * a different checkout email can't orphan the payment). The subscription is read back from Rebill, never trusted from the client.
 */
export async function linkSubscription(user: { id: string }, rebillId: string) {
  const remote = await getSubscription(rebillId).catch((error) => {
    throw new SubscriptionError(error instanceof RebillError && error.status === 404 ? "invalid_subscription" : "rebill");
  });
  const planId = leadtaPlanId(str(remote.plan?.id ?? remote.planId));
  const plan = planId ? plansForUser(subscriptionPlans, user.id).find((item) => item.id === planId) : undefined;
  if (!plan) throw new SubscriptionError("invalid_subscription");
  const existing = await byRebillId(rebillId);
  if (existing) {
    if (existing.user !== user.id) throw new SubscriptionError("forbidden");
    return;
  }
  await createRow(user.id, plan, rebillId, toStoredStatus(remote.status));
}

/** User-initiated cancel of every live subscription (Rebill first; nothing is stored as cancelled if Rebill refuses). */
export async function cancelUserSubscriptions(userId: string) {
  const live = await liveSubscriptions(userId);
  if (!live.length) throw new SubscriptionError("not_found");
  for (const row of live) await cancelRow(row);
  return live.length;
}

/** Owner status change: mirrored in Rebill before saving (Rebill subscriptions only); manual ones stay local. */
export async function syncOwnerStatusToRebill(rebillId: string | undefined, status: "authorized" | "paused" | "canceled") {
  if (!rebillId) return;
  if (status === "authorized") await updateSubscription(rebillId, { status: "active", nextChargeDate: new Date().toISOString() }); // Rebill requires a date to reactivate
  else await updateSubscription(rebillId, { status: status === "canceled" ? "cancelled" : "paused" });
}

// ---------- Webhook ----------

/** Row for a Rebill subscription; when none is linked yet, falls back to the account whose email paid (unique match only). */
async function resolveRow(rebillId: string, rebillPlanId: string, email: string) {
  const existing = await byRebillId(rebillId);
  if (existing) return existing;
  const remote = rebillPlanId && email ? null : await getSubscription(rebillId);
  const planId = leadtaPlanId(rebillPlanId || str(remote?.plan?.id ?? remote?.planId));
  const payer = (email || str(remote?.customer?.email)).trim().toLowerCase();
  if (!planId || !payer) return null;
  const users = await pocketBaseFetch<{ items: { id: string }[] }>(`/api/collections/users/records?${new URLSearchParams({ filter: `email = ${q(payer)}`, perPage: "2", skipTotal: "1", fields: "id" })}`);
  const plan = users.items.length === 1 ? plansForUser(subscriptionPlans, users.items[0].id).find((item) => item.id === planId) : undefined;
  return plan ? createRow(users.items[0].id, plan, rebillId, "pending") : null;
}

/** Credits one approved charge. The unique payment_id row is claimed first, so retries and duplicate events never pay twice. */
async function creditPayment(row: SubscriptionRow, paymentId: string, amount: number, currency: string) {
  const user = await pocketBaseFetch<{ credits?: number; email?: string; name?: string }>(`/api/collections/users/records/${row.user}?fields=credits,email,name`);
  let claim: { id: string };
  try {
    claim = await pocketBaseFetch<{ id: string }>("/api/collections/subscription_payments/records", {
      method: "POST",
      body: JSON.stringify({ subscription: row.id, user: row.user, payment_id: paymentId, status: "processing", amount_ars: currency === "ARS" && Number.isFinite(amount) ? amount : 0, credits: row.monthly_credits, balance_before: Math.max(0, user.credits ?? 0) }),
    });
  } catch (error) {
    if (error instanceof PocketBaseRequestError && error.status === 400) return; // already claimed: credited (or being credited)
    throw error;
  }
  try {
    // Relative write: concurrent searches debiting credits are not overwritten.
    await pocketBaseFetch(`/api/collections/users/records/${row.user}`, { method: "PATCH", body: JSON.stringify({ "credits+": row.monthly_credits }) });
  } catch (error) {
    // Release the claim so Rebill's retry credits it. ponytail: a crash between these two writes needs owner reconciliation.
    await pocketBaseFetch(`/api/collections/subscription_payments/records/${claim.id}`, { method: "DELETE" }).catch(() => undefined);
    throw error;
  }
  await pocketBaseFetch(`/api/collections/subscription_payments/records/${claim.id}`, { method: "PATCH", body: JSON.stringify({ status: "processed" }) });
  if (row.status === "pending") await patch(row.id, { status: "authorized" }).catch(() => undefined);
  if (!user.email) return;
  // Credits are already granted: a failed email must not fail the webhook (a retry would find the claim and skip it anyway).
  const locale = currency === "ARS" ? "es" : "en"; // Rebill Argentina charges ARS only; the webhook has no request locale
  const money = Number.isFinite(amount) ? `${new Intl.NumberFormat(locale === "es" ? "es-AR" : "en-US").format(amount)} ${currency}` : "";
  const date = new Intl.DateTimeFormat(locale === "es" ? "es-AR" : "en-US", { dateStyle: "long", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
  await sendSubscriptionReceiptEmail({ to: user.email, name: user.name, locale, planName: findPlan(subscriptionPlans, row.plan_id)?.name ?? row.plan_id, credits: row.monthly_credits, amount: money, date, paymentId })
    .catch((error) => console.error("Leadta receipt email failed:", error instanceof Error ? error.message : "unknown error"));
}

/** Processes one verified event. Unknown events and subscriptions that aren't ours return normally (200 to Rebill); an unlinked paid subscription throws so Rebill retries. */
export async function handleRebillEvent(event: string, data: Record<string, unknown>) {
  if (event === "subscription.created") {
    const subscription = rec(data.subscription);
    await resolveRow(str(subscription.id), str(subscription.planId), str(rec(data.customer).email));
    return;
  }

  if (event === "subscription.updated") {
    const row = await byRebillId(str(data.id));
    if (!row) return;
    const status = toStoredStatus(str(data.status));
    const plan = data.planUpdated === true ? findPlan(subscriptionPlans, leadtaPlanId(str(rec(data.plan).id)) ?? "") : undefined;
    const body = { ...(status !== row.status ? { status } : {}), ...(plan && plan.id !== row.plan_id ? { plan_id: plan.id, price_ars: plan.priceArs, monthly_credits: plan.credits } : {}) };
    if (Object.keys(body).length) await patch(row.id, body);
    return;
  }

  if (event === "payment.created" || event === "payment.updated") {
    const payment = event === "payment.created" ? rec(data.payment) : data;
    if (str(payment.status) !== "approved" || !str(payment.id)) return;
    // payment.updated carries no subscription id: read it from the payment.
    const remote = event === "payment.updated" ? await getPayment(str(payment.id)) : null;
    const rebillId = event === "payment.created" ? str(data.subscriptionId) : str(remote?.subscriptionId ?? remote?.subscription?.id);
    if (!rebillId) return; // one-time payment, not a subscription charge
    if (str(data.planId) && !leadtaPlanId(str(data.planId))) return; // another plan of the same Rebill organization
    const row = await resolveRow(rebillId, str(data.planId), str(rec(data.customer).email));
    if (!row) throw new SubscriptionError("not_found");
    await creditPayment(row, str(payment.id), Number(payment.amount), str(payment.currency));
  }
}
