import { findPlan, plansForUser, subscriptionPlans } from "@/lib/plans";
import { sendSubscriptionReceiptEmail } from "@/lib/server/email";
import { PocketBaseRequestError, pocketBaseFetch } from "@/lib/server/pocketbase";
import {
  createPreapproval,
  getAuthorizedPayment,
  getPreapproval,
  isMercadoPagoConfigured,
  MercadoPagoError,
  toStoredStatus,
  updatePreapproval,
} from "@/lib/server/mercadopago";

// Paid plans through Mercado Pago subscriptions (preapproval, monthly, ARS). The row is created with the checkout
// ("creating") and keyed by `external_reference` = "mp_<preapproval id>" (unique index; no extra column needed).
// The webhook keeps the status in sync and credits each approved charge once (`subscription_payments.payment_id` is unique).

type SubscriptionRow = {
  id: string;
  user: string;
  plan_id: string;
  external_reference: string;
  checkout_url?: string;
  status: string;
  price_ars: number;
  monthly_credits: number;
};

export type CurrentSubscription = { id: string; planId: string; planName: string; status: string; priceArs: number; monthlyCredits: number };

export class SubscriptionError extends Error {
  readonly code: "invalid_plan" | "already_subscribed" | "payments_unavailable" | "not_found" | "invalid_subscription" | "forbidden" | "mercadopago";
  constructor(code: SubscriptionError["code"]) { super(code); this.code = code; this.name = "SubscriptionError"; }
}

const RECORDS = "/api/collections/subscriptions/records";
/** Statuses that still bind the user to a plan. "creating" (checkout not authorized yet) is not live. */
const LIVE = ["authorized", "paused", "pending"];
const PREFIX = "mp_";
const q = (value: string) => JSON.stringify(value);

/** Mercado Pago preapproval id stored in a row's external_reference ("" for manual or older rows). */
export const preapprovalIdOf = (externalReference: string | undefined) => (externalReference?.startsWith(PREFIX) ? externalReference.slice(PREFIX.length) : "");

async function findOne(filter: string) {
  const params = new URLSearchParams({ filter, perPage: "1", skipTotal: "1", sort: "-created" });
  return (await pocketBaseFetch<{ items: SubscriptionRow[] }>(`${RECORDS}?${params}`)).items[0] ?? null;
}
const byPreapprovalId = (preapprovalId: string) => findOne(`external_reference = ${q(PREFIX + preapprovalId)}`);

async function liveSubscriptions(userId: string) {
  const params = new URLSearchParams({ filter: `user = ${q(userId)} && (${LIVE.map((s) => `status = ${q(s)}`).join(" || ")})`, perPage: "20", skipTotal: "1", sort: "-created" });
  return (await pocketBaseFetch<{ items: SubscriptionRow[] }>(`${RECORDS}?${params}`)).items;
}

const patch = (id: string, body: Record<string, unknown>) =>
  pocketBaseFetch(`${RECORDS}/${id}`, { method: "PATCH", body: JSON.stringify(body) });

function remoteError(error: unknown) {
  const status = error instanceof MercadoPagoError ? error.status : 0;
  return new SubscriptionError(status === 404 ? "invalid_subscription" : status === 503 ? "payments_unavailable" : "mercadopago");
}

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

/** Cancels in Mercado Pago (already cancelled / unknown there counts as done), then stores "canceled". */
async function cancelRow(row: SubscriptionRow) {
  const preapprovalId = preapprovalIdOf(row.external_reference);
  if (preapprovalId) {
    try {
      await updatePreapproval(preapprovalId, "cancelled");
    } catch (error) {
      const remote = await getPreapproval(preapprovalId).catch((lookup) => (lookup instanceof MercadoPagoError && lookup.status === 404 ? { status: "cancelled" } : null));
      if (toStoredStatus(remote?.status) !== "canceled") throw error;
    }
  }
  await patch(row.id, { status: "canceled" });
}

/**
 * Creates the Mercado Pago subscription for the plan (price from the catalog, ARS) and its "creating" row.
 * A pending checkout of the same plan is reused, so repeated clicks never leave two payable subscriptions for one plan.
 * Returns the checkout URL (init_point) the browser redirects to.
 */
export async function startCheckout(user: { id: string; email: string }, planId: string, backUrl: string) {
  const plan = plansForUser(subscriptionPlans, user.id).find((item) => item.id === planId);
  if (!plan) throw new SubscriptionError("invalid_plan");
  if (!isMercadoPagoConfigured()) throw new SubscriptionError("payments_unavailable");
  if ((await liveSubscriptions(user.id)).length) throw new SubscriptionError("already_subscribed");
  const pending = await findOne(`user = ${q(user.id)} && plan_id = ${q(plan.id)} && status = "creating" && checkout_url != ""`);
  if (pending?.checkout_url) {
    // Already paid but not synced yet (webhook/confirm pending): store it instead of sending the payer back to a used checkout.
    const status = toStoredStatus((await getPreapproval(preapprovalIdOf(pending.external_reference)).catch(() => null))?.status);
    if (status === "creating") return { url: pending.checkout_url };
    await patch(pending.id, { status });
    if (status !== "canceled") throw new SubscriptionError("already_subscribed");
  }

  const preapproval = await createPreapproval({ reason: `Leadta ${plan.name}`, userId: user.id, email: user.email, amountArs: plan.priceArs, backUrl }).catch((error) => {
    throw remoteError(error);
  });
  if (!preapproval.id || !preapproval.init_point) throw new SubscriptionError("mercadopago");
  await pocketBaseFetch(RECORDS, {
    method: "POST",
    body: JSON.stringify({ user: user.id, plan_id: plan.id, external_reference: PREFIX + preapproval.id, checkout_url: preapproval.init_point, status: "creating", price_ars: plan.priceArs, monthly_credits: plan.credits }),
  });
  return { url: preapproval.init_point };
}

/**
 * Back from the Mercado Pago checkout (back_url carries preapproval_id): reads the subscription from Mercado Pago, never
 * from the client, and stores its status on the signed-in user's row. Credits are only granted by the signed webhook.
 */
export async function confirmSubscription(user: { id: string }, preapprovalId: string) {
  const row = await byPreapprovalId(preapprovalId);
  if (!row) throw new SubscriptionError("invalid_subscription");
  if (row.user !== user.id) throw new SubscriptionError("forbidden");
  const remote = await getPreapproval(preapprovalId).catch((error) => {
    throw remoteError(error);
  });
  const status = toStoredStatus(remote.status);
  if (status !== row.status) await patch(row.id, { status });
  return status;
}

/** User-initiated cancel of every live subscription (Mercado Pago first; nothing is stored as cancelled if it refuses). */
export async function cancelUserSubscriptions(userId: string) {
  const live = await liveSubscriptions(userId);
  if (!live.length) throw new SubscriptionError("not_found");
  for (const row of live) await cancelRow(row);
  return live.length;
}

/** Owner status change: mirrored in Mercado Pago before saving (Mercado Pago subscriptions only); manual ones stay local. */
export async function syncOwnerStatusToMercadoPago(externalReference: string | undefined, status: "authorized" | "paused" | "canceled") {
  const preapprovalId = preapprovalIdOf(externalReference);
  if (!preapprovalId) return;
  await updatePreapproval(preapprovalId, status === "canceled" ? "cancelled" : status);
}

// ---------- Webhook ----------

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
    // Release the claim so Mercado Pago's retry credits it. ponytail: a crash between these two writes needs owner reconciliation.
    await pocketBaseFetch(`/api/collections/subscription_payments/records/${claim.id}`, { method: "DELETE" }).catch(() => undefined);
    throw error;
  }
  await pocketBaseFetch(`/api/collections/subscription_payments/records/${claim.id}`, { method: "PATCH", body: JSON.stringify({ status: "processed" }) });
  if (row.status === "creating" || row.status === "pending") await patch(row.id, { status: "authorized" }).catch(() => undefined);
  if (!user.email) return;
  // Credits are already granted: a failed email must not fail the webhook (a retry would find the claim and skip it anyway).
  // Argentina only: the receipt goes in Spanish (the webhook has no request locale).
  const money = Number.isFinite(amount) ? `${new Intl.NumberFormat("es-AR").format(amount)} ${currency}` : "";
  const date = new Intl.DateTimeFormat("es-AR", { dateStyle: "long", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
  await sendSubscriptionReceiptEmail({ to: user.email, name: user.name, locale: "es", planName: findPlan(subscriptionPlans, row.plan_id)?.name ?? row.plan_id, credits: row.monthly_credits, amount: money, date, paymentId })
    .catch((error) => console.error("Leadta receipt email failed:", error instanceof Error ? error.message : "unknown error"));
}

/**
 * Processes one verified notification (topic + data.id). The resource is always read back from Mercado Pago.
 * Unknown topics and subscriptions that aren't ours return normally (200); an approved charge without its row throws so MP retries.
 */
export async function handleMercadoPagoEvent(topic: string, dataId: string) {
  if (!dataId) return;

  if (topic === "subscription_preapproval") {
    const row = await byPreapprovalId(dataId);
    if (!row) return;
    const status = toStoredStatus((await getPreapproval(dataId)).status);
    if (status !== row.status) await patch(row.id, { status });
    return;
  }

  if (topic === "subscription_authorized_payment") {
    const charge = await getAuthorizedPayment(dataId);
    const paymentId = charge.payment?.id === undefined ? "" : String(charge.payment.id);
    if (charge.payment?.status !== "approved" || !paymentId || !charge.preapproval_id) return;
    const row = await byPreapprovalId(charge.preapproval_id);
    if (!row) throw new SubscriptionError("not_found");
    await creditPayment(row, paymentId, Number(charge.transaction_amount), charge.currency_id ?? "ARS");
  }
  // "payment" notifications of subscription charges are covered by subscription_authorized_payment.
}
