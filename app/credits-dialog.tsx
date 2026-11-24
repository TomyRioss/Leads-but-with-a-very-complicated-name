"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowRight, Check, Flame, Stars, X } from "lucide-react";
import { FaWhatsapp } from "react-icons/fa";
import { CUSTOM_PLAN_WHATSAPP, publicPlans, subscriptionPlans } from "@/lib/plans";
import { Link } from "@/i18n/navigation";
import "./modal-dialog.css";
import "./credits-dialog.css";

type Subscription = { planName: string; status: string; priceArs: number };

/** The user's plan: status and a two-step cancel. Hidden without a plan. */
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

/** Plan chooser opened from the sidebar credits pill. */
export function CreditsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations("CreditsPlans");
  const pricing = useTranslations("Pricing");
  const locale = useLocale();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [market, setMarket] = useState<"AR" | "international">("international");
  const plans = publicPlans(subscriptionPlans);
  const number = new Intl.NumberFormat(locale);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    fetch("/api/market", { cache: "no-store", signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { market?: string } | null) => {
        setMarket(payload?.market === "AR" ? "AR" : "international");
      })
      .catch(() => setMarket("international"));
    return () => controller.abort();
  }, [open]);

  const isArgentina = market === "AR";
  const href = `https://wa.me/${CUSTOM_PLAN_WHATSAPP}?text=${encodeURIComponent(isArgentina ? t("whatsappMessageArgentina") : t("whatsappMessageInternational"))}`;

  return (
    <dialog ref={dialogRef} className="modal-dialog credits-plans-dialog" aria-labelledby="credits-plans-title" aria-describedby="credits-plans-text" onClose={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal-body">
        <header className="modal-head">
          <span className="modal-icon" aria-hidden="true"><Stars size={20} /></span>
          <h2 id="credits-plans-title">{t("title")}</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label={t("close")}><X size={18} aria-hidden="true" /></button>
        </header>
        {open ? <CurrentPlan /> : null}
        <p id="credits-plans-text" className="modal-intro">{isArgentina ? t("textArgentina") : t("textInternational")}</p>
        <div className="credits-plans-grid">
          {plans.map((plan) => (
            <article key={plan.id} className={`credits-plan-card${plan.featured ? " credits-plan-card-featured" : ""}`}>
              <div className="credits-plan-heading">
                <h3>{plan.name}</h3>
                {plan.featured ? <span className="credits-plan-badge"><Flame size={14} aria-hidden="true" />{pricing("popularBadge")}</span> : null}
              </div>
              <p className="credits-plan-amount">
                <strong>{isArgentina ? `$${number.format(plan.priceArs)} ARS` : `$${number.format(plan.priceUsd)} USD`}</strong>
                <span>{pricing("perMonth")}</span>
              </p>
              <ul>
                <li><Check size={14} aria-hidden="true" />{pricing("planCredits", { credits: number.format(plan.credits) })}</li>
                <li><Check size={14} aria-hidden="true" />{pricing("planWhatsapp", { count: number.format(plan.limits.whatsappMonthly) })}</li>
                <li><Check size={14} aria-hidden="true" />{pricing("planEmail", { count: number.format(plan.limits.emailMonthly) })}</li>
                <li><Check size={14} aria-hidden="true" />{pricing("unlimitedAgent")}</li>
              </ul>
              <Link className="price-button price-button-subscribe" href="/pricing">
                {pricing("subscribe")}<ArrowRight size={16} aria-hidden="true" />
              </Link>
            </article>
          ))}
          <article className="credits-plan-card credits-plan-card-custom">
            <h3>{pricing("customName")}</h3>
            <p className="credits-plan-custom-price">{pricing("customPrice")}</p>
            <p className="credits-plan-custom-text">{pricing("customText")}</p>
            <a className="primary-button credits-plans-cta" href={href} target="_blank" rel="noopener noreferrer" onClick={onClose}>
              <FaWhatsapp size={17} aria-hidden="true" /><span>{isArgentina ? pricing("customCta") : pricing("customCtaInternational")}</span>
            </a>
          </article>
        </div>
        {isArgentina ? <p className="credits-plans-phone">{t("phone")}</p> : null}
      </div>
    </dialog>
  );
}
