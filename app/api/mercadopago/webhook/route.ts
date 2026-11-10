import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getMercadoPagoClient } from "@/lib/server/mercadopago";
import { isPocketBaseConfigured, pocketBaseFetch } from "@/lib/server/pocketbase";

type Subscription = {
  id: string;
  user: string;
  plan_id: string;
  mp_subscription_id: string;
  external_reference: string;
  status: string;
  price_ars: number;
  monthly_credits: number;
};
type PaymentEvent = { id: string; payment_id: string; status: string; credits: number; balance_before: number };
type PaymentDetails = {
  id?: number | string;
  status?: string;
  transaction_amount?: number | string;
  preapproval_id?: string;
  external_reference?: string;
};

function validSignature(signature: string, requestId: string, dataId: string, secret: string) {
  const values = Object.fromEntries(signature.split(",").map((part) => {
    const [key, value] = part.trim().split("=");
    return [key, value];
  }));
  if (!values.ts || !values.v1 || !requestId || !dataId) return false;
  const manifest = `id:${dataId};request-id:${requestId};ts:${values.ts};`;
  const expected = createHmac("sha256", secret).update(manifest).digest("hex");
  const received = values.v1;
  return expected.length === received.length && timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

async function findSubscription(filter: string) {
  const query = encodeURIComponent(filter);
  const response = await pocketBaseFetch<{ items: Subscription[] }>(`/api/collections/subscriptions/records?perPage=1&filter=${query}`);
  return response.items[0] || null;
}

async function updateSubscriptionStatus(subscription: Subscription, status: string | undefined) {
  const normalized = status === "cancelled" ? "canceled" : ["authorized", "paused", "canceled", "pending", "rejected"].includes(status || "") ? status : "pending";
  if (normalized !== subscription.status) {
    await pocketBaseFetch(`/api/collections/subscriptions/records/${subscription.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: normalized }),
    });
  }
}

async function getPaymentDetails(id: string, kind: "invoice" | "payment"): Promise<PaymentDetails> {
  const token = process.env.MP_ACCESS_TOKEN?.trim();
  if (!token) throw new Error("Mercado Pago credentials are not configured.");
  const path = kind === "invoice"
    ? `/authorized_payments/${encodeURIComponent(id)}`
    : `/v1/payments/${encodeURIComponent(id)}`;
  const response = await fetch(`https://api.mercadopago.com${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Mercado Pago returned ${response.status} for a payment lookup.`);
  return response.json() as Promise<PaymentDetails>;
}

async function acquireCreditLock(userId: string) {
  const create = () => pocketBaseFetch<{ id: string }>("/api/collections/credit_locks/records", {
    method: "POST",
    body: JSON.stringify({ user: userId }),
  });
  try {
    return await create();
  } catch {
    const query = encodeURIComponent(`user = "${userId}"`);
    const response = await pocketBaseFetch<{ items: Array<{ id: string; created: string }> }>(
      `/api/collections/credit_locks/records?perPage=1&filter=${query}`,
    ).catch(() => ({ items: [] }));
    const existing = response.items[0];
    if (!existing) throw new Error("Could not acquire credit lock.");
    if (Date.now() - Date.parse(existing.created) < 15 * 60 * 1000) throw new Error("Credit balance is currently being updated.");
    await pocketBaseFetch(`/api/collections/credit_locks/records/${existing.id}`, { method: "DELETE" });
    return create();
  }
}

async function grantMonthlyCredits(subscription: Subscription, paymentId: string, invoiceId: string, amount: number) {
  if (!paymentId || !Number.isFinite(amount) || Math.abs(amount - subscription.price_ars) > 0.01) return;
  const existingFilter = encodeURIComponent(`payment_id = "${paymentId}"`);
  const existingResponse = await pocketBaseFetch<{ items: PaymentEvent[] }>(
    `/api/collections/subscription_payments/records?perPage=1&filter=${existingFilter}`,
  );
  if (existingResponse.items[0]?.status === "processed") return;

  const lock = await acquireCreditLock(subscription.user);
  try {
    const currentUser = await pocketBaseFetch<{ credits: number }>(`/api/collections/users/records/${subscription.user}`);
    const currentCredits = Number.isFinite(currentUser.credits) && currentUser.credits >= 0 ? currentUser.credits : 0;
    let payment = existingResponse.items[0];
    if (!payment) {
      payment = await pocketBaseFetch<PaymentEvent>("/api/collections/subscription_payments/records", {
        method: "POST",
        body: JSON.stringify({
          subscription: subscription.id,
          user: subscription.user,
          payment_id: paymentId,
          invoice_id: invoiceId,
          status: "processing",
          amount_ars: amount,
          credits: subscription.monthly_credits,
          balance_before: currentCredits,
        }),
      });
    }

    const expectedBalance = payment.balance_before + payment.credits;
    if (currentCredits === expectedBalance) {
      await pocketBaseFetch(`/api/collections/subscription_payments/records/${payment.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "processed" }),
      });
      return;
    }
    if (currentCredits !== payment.balance_before) throw new Error("Payment credit grant needs reconciliation.");

    await pocketBaseFetch(`/api/collections/users/records/${subscription.user}`, {
      method: "PATCH",
      body: JSON.stringify({ credits: expectedBalance }),
    });
    await pocketBaseFetch(`/api/collections/subscription_payments/records/${payment.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "processed" }),
    });
  } finally {
    await pocketBaseFetch(`/api/collections/credit_locks/records/${lock.id}`, { method: "DELETE" }).catch(() => undefined);
  }
}

export async function POST(request: Request) {
  const secret = process.env.MP_WEBHOOK_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "Webhook signature verification is not configured." }, { status: 503 });
  if (!isPocketBaseConfigured()) return NextResponse.json({ error: "PocketBase is not configured." }, { status: 503 });

  let payload: { type?: string; action?: string; data?: { id?: string | number } };
  try {
    payload = await request.json();
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  const dataId = payload.data?.id === undefined ? "" : String(payload.data.id);
  if (!validSignature(request.headers.get("x-signature") || "", request.headers.get("x-request-id") || "", dataId, secret)) {
    return new NextResponse(null, { status: 401 });
  }

  try {
    if (payload.type === "subscription_preapproval") {
      const client = getMercadoPagoClient();
      if (!client) throw new Error("Mercado Pago credentials are not configured.");
      const remote = await client.get({ id: dataId });
      const reference = typeof remote.external_reference === "string" || typeof remote.external_reference === "number"
        ? String(remote.external_reference)
        : "";
      const subscription = reference ? await findSubscription(`external_reference = "${reference}"`) : null;
      if (subscription) await updateSubscriptionStatus(subscription, remote.status);
    }

    if (payload.type === "subscription_authorized_payment" || payload.type === "payment") {
      const details = await getPaymentDetails(dataId, payload.type === "payment" ? "payment" : "invoice");
      const payment = payload.type === "payment" ? details : (details as PaymentDetails & { payment?: PaymentDetails }).payment;
      const subscriptionId = payload.type === "payment"
        ? details.preapproval_id
        : (details as PaymentDetails & { preapproval_id?: string }).preapproval_id;
      if (payment?.status === "approved" && payment.id && subscriptionId) {
        const subscription = await findSubscription(`mp_subscription_id = "${String(subscriptionId)}"`);
        if (subscription) {
          await grantMonthlyCredits(
            subscription,
            String(payment.id),
            dataId,
            Number(payment.transaction_amount ?? details.transaction_amount),
          );
        }
      } else if (payment?.status === "approved" && payment.id && details.external_reference) {
        const subscription = await findSubscription(`external_reference = "${String(details.external_reference)}"`);
        if (subscription) {
          await grantMonthlyCredits(
            subscription,
            String(payment.id),
            dataId,
            Number(payment.transaction_amount ?? details.transaction_amount),
          );
        }
      }
    }

    return new NextResponse(null, { status: 200 });
  } catch (error) {
    console.error("Mercado Pago webhook processing failed:", error instanceof Error ? error.name : "unknown");
    return new NextResponse(null, { status: 500 });
  }
}
