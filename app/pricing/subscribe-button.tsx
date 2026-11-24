"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, LoaderCircle, X } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import "@/app/modal-dialog.css";
import "@/app/credits-dialog.css"; // .credits-plan-keep, .danger-button are styled there
import { resetCurrentPlan, useCurrentPlan } from "./current-plan";

type Checkout = { publicKey: string; rebillPlanId: string; email: string };

const ERRORS: Record<string, string> = {
  already_subscribed: "errorAlreadySubscribed",
  not_configured: "errorNotConfigured",
};

/** Rebill checkout widget (web component, loaded on demand) in a modal. On success the subscription is linked to this account. */
function CheckoutDialog({ checkout, label, onClose }: { checkout: Checkout; label: string; onClose: () => void }) {
  const t = useTranslations("Pricing");
  const locale = useLocale();
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  useEffect(() => {
    let element: HTMLElement | undefined;
    let cancelled = false;
    const onSuccess = async (event: Event) => {
      const detail = (event as CustomEvent<{ data?: { result?: { subscriptionId?: string | null } } }>).detail;
      const subscriptionId = detail?.data?.result?.subscriptionId;
      // Without an id there is nothing to link: the webhook matches the payer's email. Credits and the receipt email come from the webhook.
      const response = subscriptionId ? await fetch("/api/subscriptions/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscriptionId }) }).catch(() => null) : null;
      resetCurrentPlan();
      if (!subscriptionId || response?.ok) router.push("/leadtita");
      else setError(true);
    };
    import("rebill").then(() => {
      if (cancelled || !hostRef.current) return;
      const node = document.createElement("rebill-checkout") as unknown as HTMLElement; // the package's typing conflicts with lib.dom
      node.setAttribute("public-key", checkout.publicKey);
      node.setAttribute("plan-id", checkout.rebillPlanId);
      node.setAttribute("language", locale === "es" ? "es" : "en");
      node.setAttribute("customer-information", JSON.stringify({ email: checkout.email }));
      // The widget lays summary and form out against the viewport and overlaps inside a modal: the plan summary is ours (label).
      node.setAttribute("display", JSON.stringify({ checkoutSummary: false, logo: false }));
      node.addEventListener("success", onSuccess);
      hostRef.current.append(node);
      element = node;
    });
    return () => {
      cancelled = true;
      element?.removeEventListener("success", onSuccess);
      element?.remove();
    };
  }, [checkout, locale, router]);

  return (
    <dialog ref={dialogRef} className="modal-dialog w-[min(560px,calc(100vw-32px))]!" aria-labelledby="checkout-title" onClose={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal-body">
        <header className="modal-head">
          <h2 id="checkout-title">{t("checkoutTitle")}</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label={t("checkoutClose")}><X size={18} aria-hidden="true" /></button>
        </header>
        <p className="m-0 text-sm font-semibold text-(color:--ink)">{label}</p>
        <div ref={hostRef} className="min-h-72" />
        {error ? <p role="alert" className="m-0 text-sm text-(color:--ink)">{t("checkoutLinkError")}</p> : null}
      </div>
    </dialog>
  );
}

/** Opens the Rebill checkout for `planId`. Signed-out visitors go to login. */
export function SubscribeButton({ planId, label }: { planId: string; label: string }) {
  const t = useTranslations("Pricing");
  const tc = useTranslations("CreditsPlans"); // cancel texts are shared with the credits dialog
  const router = useRouter();
  const currentPlan = useCurrentPlan();
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [checkout, setCheckout] = useState<Checkout | null>(null);

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
      const payload = await response.json().catch(() => ({})) as Partial<Checkout> & { error?: string };
      if (response.status === 401) return router.push("/login");
      if (response.ok && payload.publicKey && payload.rebillPlanId && payload.email) setCheckout({ publicKey: payload.publicKey, rebillPlanId: payload.rebillPlanId, email: payload.email });
      else setError(t(ERRORS[payload.error ?? ""] ?? "errorGeneric"));
    } catch {
      setError(t("errorGeneric"));
    } finally {
      setBusy(false);
    }
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
      {checkout ? <CheckoutDialog checkout={checkout} label={label} onClose={() => setCheckout(null)} /> : null}
    </div>
  );
}
