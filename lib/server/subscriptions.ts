import { randomUUID } from "node:crypto";
import { findPlan, plansForUser, subscriptionPlans } from "@/lib/plans";
import {
  createPreapproval,
  getAuthorizedPayment,
  getPayment,
  getPreapproval,
  MercadoPagoError,
  setPreapprovalStatus,
  toStoredStatus,
} from "@/lib/server/mercadopago";
import { PocketBaseRequestError, pocketBaseFetch } from "@/lib/server/pocketbase";

// Paid plans through Mercado Pago subscriptions (preapproval, ARS). PocketBase `subscriptions` mirrors MP; the webhook
// keeps the status in sync and credits each approved monthly charge once (`subscription_payments.payment_id` is unique).

type SubscriptionRow = {
  id: string;
  user: string;
  plan_id: string;
  external_reference: string;
  mp_subscription_id?: string;
  checkout_url?: string;
  status: string;
  price_ars: number;
  monthly_credits: number;
};

export type CurrentSubscription = { id: string; planId: string; planName: string; status: string; priceArs: number; monthlyCredits: number; checkoutUrl: string };

export class SubscriptionError extends Error {
  readonly code: "invalid_plan" | "already_subscribed" | "checkout_busy" | "not_found" | "mercadopago";
  constructor(code: SubscriptionError["code"]) { super(code); this.code = code; this.name = "SubscriptionError"; }
}

const RECORDS = "/api/collections/subscriptions/records";
/** Statuses that still bind the user to MP (charging, paused or awaiting authorization). */
const LIVE = ["authorized", "paused", "pending", "creating"];
const q = (value: string) => JSON.stringify(value);

async function findOne(filter: string) {
  const params = new URLSearchParams({ filter, perPage: "1", skipTotal: "1", sort: "-created" });
  return (await pocketBaseFetch<{ items: SubscriptionRow[] }>(`${RECORDS}?${params}`)).items[0] ?? null;
}

async function liveSubscriptions(userId: string) {
  const params = new URLSearchParams({ filter: `user = ${q(userId)} && (${LIVE.map((s) => `status = ${q(s)}`).join(" || ")})`, perPage: "20", skipTotal: "1", sort: "-created" });
  return (await pocketBaseFetch<{ items: SubscriptionRow[] }>(`${RECORDS}?${params}`)).items;
}

const patch = (id: string, body: Record<string, unknown>) =>
  pocketBaseFetch(`${RECORDS}/${id}`, { method: "PATCH", body: JSON.stringify(body) });

/** Newest live subscription of the user, or null. */
export async function getCurrentSubscription(userId: string): Promise<CurrentSubscription | null> {
  const row = (await liveSubscriptions(userId)).find((item) => item.status !== "creating");
  if (!row) return null;
  return {
    id: row.id,
    planId: row.plan_id,
    planName: findPlan(subscriptionPlans, row.plan_id)?.name ?? row.plan_id,
    status: row.status,
    priceArs: row.price_ars,
    monthlyCredits: row.monthly_credits,
    checkoutUrl: row.status === "pending" ? row.checkout_url ?? "" : "",
  };
}

/** Cancels in MP (already cancelled / unknown there counts as done), then stores "canceled". */
async function cancelRow(row: SubscriptionRow) {
  if (row.mp_subscription_id) {
    try {
      await setPreapprovalStatus(row.mp_subscription_id, "cancelled");
    } catch (error) {
      const remote = await getPreapproval(row.mp_subscription_id).catch((lookup) => (lookup instanceof MercadoPagoError && lookup.status === 404 ? { status: "cancelled" } : null));
      if (toStoredStatus(remote?.status) !== "canceled") throw error;
    }
  }
  await patch(row.id, { status: "canceled" });
}

/**
 * Starts the MP checkout for `planId`: one live paid subscription per user. An abandoned pending checkout is
 * cancelled and replaced. Returns MP's init_point. The checkout lock serializes double clicks.
 */
export async function startCheckout(user: { id: string; email: string }, planId: string, appUrl: string) {
  const plan = plansForUser(subscriptionPlans, user.id).find((item) => item.id === planId);
  if (!plan) throw new SubscriptionError("invalid_plan");

  let lockId = "";
  try {
    lockId = (await pocketBaseFetch<{ id: string }>("/api/collections/subscription_checkout_locks/records", { method: "POST", body: JSON.stringify({ user: user.id }) })).id;
  } catch (error) {
    if (error instanceof PocketBaseRequestError && error.status === 400) throw new SubscriptionError("checkout_busy");
    throw error;
  }

  let rowId = "";
  try {
    const live = await liveSubscriptions(user.id);
    if (live.some((row) => row.status === "authorized" || row.status === "paused")) throw new SubscriptionError("already_subscribed");
    for (const row of live) await cancelRow(row); // abandoned pending / creating checkouts

    const externalReference = `leadta_${randomUUID()}`;
    rowId = (await pocketBaseFetch<{ id: string }>(RECORDS, {
      method: "POST",
      body: JSON.stringify({ user: user.id, plan_id: plan.id, external_reference: externalReference, mp_subscription_id: "", status: "creating", price_ars: plan.priceArs, monthly_credits: plan.credits }),
    })).id;

    const backUrl = new URL("/pricing", appUrl);
    backUrl.searchParams.set("subscription", "return");
    let created;
    try {
      created = await createPreapproval({ reason: `Leadta ${plan.name}`, externalReference, payerEmail: user.email, amountArs: plan.priceArs, backUrl: backUrl.toString() });
    } catch (error) {
      console.error("Mercado Pago preapproval create failed", error instanceof MercadoPagoError ? error.status : "unknown");
      throw new SubscriptionError("mercadopago");
    }
    if (!created.id || !created.init_point) throw new SubscriptionError("mercadopago");
    await patch(rowId, { mp_subscription_id: String(created.id), checkout_url: created.init_point, status: toStoredStatus(created.status) });
    return { initPoint: created.init_point };
  } catch (error) {
    if (rowId) await patch(rowId, { status: "failed" }).catch(() => undefined);
    throw error;
  } finally {
    await pocketBaseFetch(`/api/collections/subscription_checkout_locks/records/${lockId}`, { method: "DELETE" }).catch(() => undefined);
  }
}

/** User-initiated cancel of every live subscription (MP first; nothing is stored as cancelled if MP refuses). */
export async function cancelUserSubscriptions(userId: string) {
  const live = await liveSubscriptions(userId);
  if (!live.length) throw new SubscriptionError("not_found");
  for (const row of live) await cancelRow(row);
  return live.length;
}

/** Owner status change: mirrored in MP before saving (MP subscriptions only); manual ones stay local. */
export async function syncOwnerStatusToMercadoPago(mpSubscriptionId: string | undefined, status: "authorized" | "paused" | "canceled") {
  if (!mpSubscriptionId) return;
  await setPreapprovalStatus(mpSubscriptionId, status === "canceled" ? "cancelled" : status);
}

// ---------- Webhook ----------

/** Credits one approved charge. The unique payment_id row is claimed first, so retries and duplicate topics never pay twice. */
async function creditPayment(row: SubscriptionRow, paymentId: string, invoiceId: string, amount: number) {
  if (!Number.isFinite(amount) || Math.abs(amount - row.price_ars) > 0.01) {
    console.error("Mercado Pago charge amount does not match the subscription", row.id);
    return;
  }
  const user = await pocketBaseFetch<{ credits?: number }>(`/api/collections/users/records/${row.user}?fields=credits`);
  let claim: { id: string };
  try {
    claim = await pocketBaseFetch<{ id: string }>("/api/collections/subscription_payments/records", {
      method: "POST",
      body: JSON.stringify({ subscription: row.id, user: row.user, payment_id: paymentId, invoice_id: invoiceId, status: "processing", amount_ars: amount, credits: row.monthly_credits, balance_before: Math.max(0, user.credits ?? 0) }),
    });
  } catch (error) {
    if (error instanceof PocketBaseRequestError && error.status === 400) return; // already claimed: credited (or being credited)
    throw error;
  }
  try {
    // Relative write: concurrent searches debiting credits are not overwritten.
    await pocketBaseFetch(`/api/collections/users/records/${row.user}`, { method: "PATCH", body: JSON.stringify({ "credits+": row.monthly_credits }) });
  } catch (error) {
    // Release the claim so MP's retry credits it. ponytail: a crash between these two writes needs owner reconciliation.
    await pocketBaseFetch(`/api/collections/subscription_payments/records/${claim.id}`, { method: "DELETE" }).catch(() => undefined);
    throw error;
  }
  await pocketBaseFetch(`/api/collections/subscription_payments/records/${claim.id}`, { method: "PATCH", body: JSON.stringify({ status: "processed" }) });
  if (row.status !== "authorized") await patch(row.id, { status: "authorized" }).catch(() => undefined);
}

/** Processes one verified notification. Unknown topics and records that aren't ours are ignored (200 to MP). */
export async function handleMercadoPagoNotification(type: string, dataId: string) {
  if (type === "subscription_preapproval") {
    const remote = await getPreapproval(dataId);
    const row = await findOne(`mp_subscription_id = ${q(String(remote.id))}`)
      ?? (remote.external_reference ? await findOne(`external_reference = ${q(String(remote.external_reference))}`) : null);
    const status = toStoredStatus(remote.status);
    if (row && row.status !== status && row.status !== "failed") await patch(row.id, { status, ...(row.mp_subscription_id ? {} : { mp_subscription_id: String(remote.id) }) });
    return;
  }

  if (type === "subscription_authorized_payment") {
    const invoice = await getAuthorizedPayment(dataId);
    if (invoice.payment?.status !== "approved" || !invoice.payment.id || !invoice.preapproval_id) return;
    const row = await findOne(`mp_subscription_id = ${q(invoice.preapproval_id)}`);
    if (row) await creditPayment(row, String(invoice.payment.id), dataId, Number(invoice.transaction_amount));
    return;
  }

  if (type === "payment") {
    const payment = await getPayment(dataId);
    if (payment.status !== "approved" || !payment.id) return;
    const preapprovalId = payment.metadata?.preapproval_id ?? payment.point_of_interaction?.transaction_data?.subscription_id;
    const row = preapprovalId
      ? await findOne(`mp_subscription_id = ${q(preapprovalId)}`)
      : payment.external_reference?.startsWith("leadta_") ? await findOne(`external_reference = ${q(payment.external_reference)}`) : null;
    if (row) await creditPayment(row, String(payment.id), "", Number(payment.transaction_amount));
  }
}
