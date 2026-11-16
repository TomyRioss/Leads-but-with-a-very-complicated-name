"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { useRouter } from "@/i18n/navigation";

const ERRORS: Record<string, string> = {
  already_subscribed: "errorAlreadySubscribed",
  checkout_busy: "errorBusy",
  not_configured: "errorNotConfigured",
};

/** Starts the Mercado Pago checkout for `planId` and sends the browser to MP. Signed-out visitors go to login. */
export function SubscribeButton({ planId }: { planId: string }) {
  const t = useTranslations("Pricing");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function subscribe() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/subscriptions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planId }) });
      const payload = await response.json().catch(() => ({})) as { initPoint?: string; error?: string };
      if (response.status === 401) return router.push("/login");
      if (response.ok && payload.initPoint) return window.location.assign(payload.initPoint);
      setError(t(ERRORS[payload.error ?? ""] ?? "errorGeneric"));
    } catch {
      setError(t("errorGeneric"));
    }
    setBusy(false);
  }

  return (
    <div className="price-subscribe">
      <button type="button" className="price-button price-button-dark" onClick={subscribe} disabled={busy} aria-busy={busy}>
        {busy ? t("subscribing") : t("subscribe")}
        {busy ? <LoaderCircle size={16} className="price-spin" aria-hidden="true" /> : <ArrowRight size={16} aria-hidden="true" />}
      </button>
      {error ? <p className="price-subscribe-error" role="alert">{error}</p> : null}
    </div>
  );
}
