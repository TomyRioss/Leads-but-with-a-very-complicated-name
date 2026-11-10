import { MercadoPagoConfig, PreApproval } from "mercadopago";
import type { PreApprovalResponse } from "mercadopago/dist/clients/preApproval/commonTypes";

export function getMercadoPagoClient() {
  const accessToken = process.env.MP_ACCESS_TOKEN?.trim();
  if (!accessToken) return null;
  return new PreApproval(new MercadoPagoConfig({ accessToken, options: { timeout: 10_000 } }));
}

export type MercadoPagoSubscription = PreApprovalResponse;

// Subscription lookup and lifecycle requests use https://api.mercadopago.com/preapproval/{id} through the official SDK.

export function mapMercadoPagoSubscriptionStatus(status: string | undefined) {
  switch (status) {
    case "authorized":
    case "paused":
    case "pending":
    case "rejected":
      return status;
    case "cancelled":
      return "canceled";
    case "canceled":
      return status;
    default:
      return "pending";
  }
}

export function getApplicationUrl(request?: Request) {
  const configured = process.env.APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  if (process.env.NODE_ENV === "production") throw new Error("APP_URL no está configurada.");
  return request ? new URL(request.url).origin : "http://localhost:3000";
}
