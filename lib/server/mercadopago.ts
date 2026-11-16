import { createHmac, timingSafeEqual } from "node:crypto";

// Mercado Pago REST client (Argentina: subscriptions are "preapproval", charged in ARS). Plain fetch, no SDK.
// Docs: https://www.mercadopago.com.ar/developers/es/reference/subscriptions/_preapproval/post

const API = "https://api.mercadopago.com";
const TIMEOUT_MS = 10_000;

export type MercadoPagoPreapproval = { id: string; status?: string; init_point?: string; external_reference?: string; payer_email?: string };
/** GET /authorized_payments/{id}: one recurring charge of a preapproval. */
export type MercadoPagoAuthorizedPayment = { id?: number | string; preapproval_id?: string; transaction_amount?: number; payment?: { id?: number | string; status?: string } };
/** GET /v1/payments/{id}: subscription charges carry the preapproval id in metadata or point_of_interaction. */
export type MercadoPagoPayment = {
  id?: number | string;
  status?: string;
  transaction_amount?: number;
  external_reference?: string;
  metadata?: { preapproval_id?: string };
  point_of_interaction?: { transaction_data?: { subscription_id?: string } };
};

export class MercadoPagoError extends Error {
  readonly status: number;
  constructor(status: number, path: string) {
    super(`Mercado Pago ${path.split("/")[1] ?? "request"} failed with ${status}.`);
    this.name = "MercadoPagoError";
    this.status = status;
  }
}

const accessToken = () => process.env.MP_ACCESS_TOKEN?.trim() ?? "";
const webhookSecret = () => process.env.MP_WEBHOOK_SECRET?.trim() ?? "";
export const isMercadoPagoConfigured = () => Boolean(accessToken() && webhookSecret());

async function mp<T>(path: string, init: { method?: "GET" | "POST" | "PUT"; body?: unknown; idempotencyKey?: string } = {}): Promise<T> {
  const token = accessToken();
  if (!token) throw new MercadoPagoError(503, path);
  const response = await fetch(`${API}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.idempotencyKey ? { "X-Idempotency-Key": init.idempotencyKey } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new MercadoPagoError(response.status, path);
  return response.json() as Promise<T>;
}

/** Monthly ARS subscription without a card on file: the payer authorizes it on MP's init_point. */
export function createPreapproval(input: { reason: string; externalReference: string; payerEmail: string; amountArs: number; backUrl: string }) {
  return mp<MercadoPagoPreapproval>("/preapproval", {
    method: "POST",
    idempotencyKey: input.externalReference,
    body: {
      reason: input.reason,
      external_reference: input.externalReference,
      payer_email: input.payerEmail,
      auto_recurring: { frequency: 1, frequency_type: "months", transaction_amount: input.amountArs, currency_id: "ARS" },
      back_url: input.backUrl,
      status: "pending",
    },
  });
}

const id = (value: string) => encodeURIComponent(value);
export const getPreapproval = (preapprovalId: string) => mp<MercadoPagoPreapproval>(`/preapproval/${id(preapprovalId)}`);
export const setPreapprovalStatus = (preapprovalId: string, status: "authorized" | "paused" | "cancelled") =>
  mp<MercadoPagoPreapproval>(`/preapproval/${id(preapprovalId)}`, { method: "PUT", body: { status } });
export const getAuthorizedPayment = (paymentId: string) => mp<MercadoPagoAuthorizedPayment>(`/authorized_payments/${id(paymentId)}`);
export const getPayment = (paymentId: string) => mp<MercadoPagoPayment>(`/v1/payments/${id(paymentId)}`);

/** MP spelling → stored status. Cancelled ones are stored as "canceled" (same as the owner panel). */
export function toStoredStatus(status: string | undefined) {
  if (status === "cancelled" || status === "canceled") return "canceled";
  return status === "authorized" || status === "paused" || status === "pending" || status === "rejected" ? status : "pending";
}

/**
 * Webhook signature (x-signature "ts=…,v1=…"): HMAC-SHA256 of "id:{data.id};request-id:{x-request-id};ts:{ts};"
 * with the webhook secret. Parts whose value is missing are left out, as MP documents. data.id is lowercased.
 */
export function isValidWebhookSignature(signature: string, requestId: string, dataId: string, secret = webhookSecret()) {
  const parts = Object.fromEntries(signature.split(",").map((part) => part.trim().split("=", 2) as [string, string]));
  if (!secret || !parts.ts || !parts.v1) return false;
  const manifest = `${dataId ? `id:${dataId.toLowerCase()};` : ""}${requestId ? `request-id:${requestId};` : ""}ts:${parts.ts};`;
  const expected = Buffer.from(createHmac("sha256", secret).update(manifest).digest("hex"));
  const received = Buffer.from(parts.v1);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
