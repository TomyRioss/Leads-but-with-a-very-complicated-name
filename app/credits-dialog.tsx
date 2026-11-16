"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Stars, X } from "lucide-react";
import { FaWhatsapp } from "react-icons/fa";
import "./modal-dialog.css";
import "./credits-dialog.css";

const SALES_WHATSAPP = "5491134083140";

type Subscription = { planName: string; status: string; priceArs: number; checkoutUrl: string };

/** The user's Mercado Pago plan: status, pending checkout link and a two-step cancel. Hidden without a plan. */
function CurrentPlan() {
  const t = useTranslations("CreditsPlans");
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/subscriptions", { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { subscription?: Subscription | null } | null) => setSubscription(payload?.subscription ?? null))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  async function cancel() {
    setState("busy");
    const response = await fetch("/api/subscriptions", { method: "DELETE" }).catch(() => null);
    setState(response?.ok ? "done" : "error");
    if (response?.ok) setConfirming(false);
  }

  if (!subscription) return null;
  if (state === "done") return <p className="credits-plan-current" role="status">{t("cancelled")}</p>;
  const status = ["authorized", "paused", "pending"].includes(subscription.status) ? subscription.status : "pending";
  return (
    <section className="credits-plan-current" aria-labelledby="credits-plan-current-title">
      <p id="credits-plan-current-title"><strong>{t("currentPlan", { plan: subscription.planName })}</strong> · {t(`status.${status}`)}</p>
      {subscription.checkoutUrl ? <a className="credits-plan-link" href={subscription.checkoutUrl}>{t("completePayment")}</a> : null}
      {confirming ? (
        <div className="credits-plan-confirm">
          <p>{t("cancelConfirm")}</p>
          <div>
            <button type="button" className="danger-button" onClick={cancel} disabled={state === "busy"}>{state === "busy" ? t("cancelling") : t("cancelYes")}</button>
            <button type="button" className="credits-plan-keep" onClick={() => setConfirming(false)} disabled={state === "busy"}>{t("cancelNo")}</button>
          </div>
        </div>
      ) : (
        <button type="button" className="credits-plan-keep" onClick={() => { setConfirming(true); setState("idle"); }}>{t("cancel")}</button>
      )}
      {state === "error" ? <p role="alert">{t("cancelError")}</p> : null}
    </section>
  );
}

/** Custom-plan modal opened from the sidebar credits pill: plans are tailored, so the CTA goes to sales on WhatsApp. */
export function CreditsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations("CreditsPlans");
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const href = `https://wa.me/${SALES_WHATSAPP}?text=${encodeURIComponent(t("whatsappMessage"))}`;

  return (
    <dialog ref={dialogRef} className="modal-dialog" aria-labelledby="credits-plans-title" aria-describedby="credits-plans-text" onClose={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal-body">
        <header className="modal-head">
          <span className="modal-icon" aria-hidden="true"><Stars size={20} /></span>
          <h2 id="credits-plans-title">{t("title")}</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label={t("close")}><X size={18} aria-hidden="true" /></button>
        </header>
        {open ? <CurrentPlan /> : null}
        <p className="credits-plans-price"><span>{t("from")}</span> <strong>{t("price")}</strong></p>
        <p id="credits-plans-text" className="modal-intro">{t("text")}</p>
        <a className="primary-button credits-plans-cta" href={href} target="_blank" rel="noopener noreferrer" onClick={onClose}>
          <FaWhatsapp size={17} aria-hidden="true" /><span>{t("cta")}</span>
        </a>
        <p className="credits-plans-phone">{t("phone")}</p>
      </div>
    </dialog>
  );
}
