import { createHmac, timingSafeEqual } from "node:crypto";

// Mercado Pago REST client for subscriptions without an associated plan (/preapproval), Argentina only, ARS.
// Plain fetch, no SDK. Test or production depends on the access token (test credentials act on test users).
// Docs: https://www.mercadopago.com.ar/developers/es/reference/online-payments/subscriptions/create-preapproval/post
// Webhooks: https://www.mercadopago.com.ar/developers/es/docs/your-integrations/notifications/webhooks

const API = "https://api.mercadopago.com";
const TIMEOUT_MS = 10_000;

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

export type Preapproval = {
  id?: string;
  status?: string;
  external_reference?: string;
  payer_email?: string;
  init_point?: string;
  auto_recurring?: { transaction_amount?: number; currency_id?: string };
};
export type AuthorizedPayment = {
  id?: string | number;
  preapproval_id?: string;
  status?: string;
  transaction_amount?: number;
  currency_id?: string;
  payment?: { id?: string | number; status?: string };
};

async function mp<T>(path: string, init: { method?: "GET" | "POST" | "PUT"; body?: unknown } = {}): Promise<T> {
  const token = accessToken();
  if (!token) throw new MercadoPagoError(503, path);
  const response = await fetch(`${API}${path}`, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new MercadoPagoError(response.status, path);
  return response.json() as Promise<T>;
}

const id = (value: string) => encodeURIComponent(value);

/** Monthly ARS subscription in "pending" status: the payer authorizes the card at `init_point`, then MP redirects to `backUrl?preapproval_id=…`. */
export const createPreapproval = (input: { reason: string; userId: string; email: string; amountArs: number; backUrl: string }) =>
  mp<Preapproval>("/preapproval", {
    method: "POST",
    body: {
      reason: input.reason,
      external_reference: input.userId,
      payer_email: input.email,
      back_url: input.backUrl,
      status: "pending",
      auto_recurring: { frequency: 1, frequency_type: "months", transaction_amount: input.amountArs, currency_id: "ARS" },
    },
  });
export const getPreapproval = (preapprovalId: string) => mp<Preapproval>(`/preapproval/${id(preapprovalId)}`);
export const updatePreapproval = (preapprovalId: string, status: "authorized" | "paused" | "cancelled") =>
  mp<Preapproval>(`/preapproval/${id(preapprovalId)}`, { method: "PUT", body: { status } });
/** One monthly charge of a preapproval (webhook topic subscription_authorized_payment). */
export const getAuthorizedPayment = (authorizedPaymentId: string) => mp<AuthorizedPayment>(`/authorized_payments/${id(authorizedPaymentId)}`);

/** Preapproval status → stored status. "pending" = the payer has not authorized yet ("creating": no access, not live). */
export function toStoredStatus(status: string | undefined) {
  if (status === "authorized") return "authorized";
  if (status === "paused") return "paused";
  if (status === "cancelled" || status === "finished") return "canceled";
  return "creating";
}

/**
 * x-signature "ts=<ms>,v1=<hex>": v1 is HMAC-SHA256 (hex) of the manifest `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`
 * keyed with the webhook secret. Pairs whose value is missing are left out of the manifest; data.id goes lowercase.
 * ponytail: no ts tolerance window; a replayed valid event is idempotent (status read back from MP, payments claimed once).
 */
export function isValidWebhookSignature(input: { signature: string; requestId: string; dataId: string }, secret = webhookSecret()) {
  if (!secret || !input.signature) return false;
  const parts = Object.fromEntries(input.signature.split(",").map((part) => part.trim().split("=", 2).map((value) => value?.trim() ?? "")));
  const ts = parts.ts ?? "";
  const v1 = (parts.v1 ?? "").toLowerCase();
  if (!ts || !v1) return false;
  const manifest = `${input.dataId ? `id:${input.dataId.toLowerCase()};` : ""}${input.requestId ? `request-id:${input.requestId};` : ""}ts:${ts};`;
  const expected = Buffer.from(createHmac("sha256", secret).update(manifest).digest("hex"));
  const received = Buffer.from(v1);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
