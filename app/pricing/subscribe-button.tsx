"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, LoaderCircle } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import "@/app/credits-dialog.css"; // .credits-plan-keep, .danger-button are styled there
import { resetCurrentPlan, useCurrentPlan } from "./current-plan";

const ERRORS: Record<string, string> = {
  already_subscribed: "errorAlreadySubscribed",
  payments_unavailable: "errorNotConfigured",
};

/** Sends the browser to the Mercado Pago checkout for `planId` (back_url returns to /api/subscriptions/confirm). Signed-out visitors go to login. */
export function SubscribeButton({ planId }: { planId: string; label?: string }) {
  const t = useTranslations("Pricing");
  const tc = useTranslations("CreditsPlans"); // cancel texts are shared with the credits dialog
  const router = useRouter();
  const currentPlan = useCurrentPlan();
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function cancel() {
    setCancelling(true);
    const response = await fetch("/api/subscriptions", { method: "DELETE" }).catch(() => null);
    setCancelling(false);
    if (response?.ok) {
      setConfirming(false);
      resetCurrentPlan(); // every plan button asks again and goes back to "Subscribe"
    } else {
      setError(tc("cancelError"));
    }
  }

  async function subscribe() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/subscriptions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planId }) });
      const payload = await response.json().catch(() => ({})) as { url?: string; error?: string };
      if (response.status === 401) return router.push("/login");
      if (response.ok && payload.url?.startsWith("https://")) return window.location.assign(payload.url); // stays busy while leaving
      setError(t(ERRORS[payload.error ?? ""] ?? "errorGeneric"));
    } catch {
      setError(t("errorGeneric"));
    }
    setBusy(false);
  }

  return (
    <div className="mt-auto grid gap-4">
      {currentPlan === planId ? (
        <>
          <p className="price-button price-button-subscribe m-0 cursor-default justify-center opacity-75" aria-current="true"><Check size={16} aria-hidden="true" />{t("currentPlanLabel")}</p>
          {confirming ? (
            <div className="grid gap-2.5">
              <p className="m-0 text-sm leading-normal text-(color:--ink)">{tc("cancelConfirm")}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="danger-button" onClick={cancel} disabled={cancelling}>{cancelling ? tc("cancelling") : tc("cancelYes")}</button>
                <button type="button" className="credits-plan-keep" onClick={() => setConfirming(false)} disabled={cancelling}>{tc("cancelNo")}</button>
              </div>
            </div>
          ) : (
            <button type="button" className="cursor-pointer justify-self-center text-sm font-semibold text-(color:--muted) underline underline-offset-4 hover:text-(color:--ink)" onClick={() => { setConfirming(true); setError(""); }}>{tc("cancel")}</button>
          )}
        </>
      ) : (
        <button type="button" className="price-button price-button-subscribe justify-center disabled:cursor-progress disabled:opacity-75" onClick={subscribe} disabled={busy} aria-busy={busy}>
          {busy ? t("subscribing") : t("subscribe")}
          {busy ? <LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
        </button>
      )}
      {error ? <p className="m-0 text-sm leading-normal text-(color:--ink)" role="alert">{error}</p> : null}
    </div>
  );
}
