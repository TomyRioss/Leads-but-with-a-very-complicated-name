"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, Loader2 } from "lucide-react";
import { FaWhatsapp } from "react-icons/fa";
import { CUSTOM_PLAN_WHATSAPP, publicPlans, subscriptionPlans } from "@/lib/plans";
import { SubscribeButton } from "@/app/pricing/subscribe-button";

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(color:--ink)";
const CARD = "flex flex-col gap-3 rounded-xl border bg-(--paper) p-4";

/** Same rule as /pricing (MarketPricing): online subscribe only in Argentina or in the dev environment. null while unknown. */
function useCanSubscribe() {
  const [state, setState] = useState<{ argentina: boolean; canSubscribe: boolean } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const json = (url: string) => fetch(url, { cache: "no-store", signal: controller.signal }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    void Promise.all([json("/api/market"), json("/api/status")]).then(([market, status]: [{ market?: string } | null, { environment?: string } | null]) => {
      if (controller.signal.aborted) return;
      const argentina = market?.market === "AR";
      setState({ argentina, canSubscribe: argentina || status?.environment === "dev" });
    });
    return () => controller.abort();
  }, []);
  return state;
}

/** Plans of /pricing inside the onboarding: same catalog, prices, texts and Mercado Pago subscribe button. */
export function PlanPicker({ currentPlanId }: { currentPlanId?: string }) {
  const t = useTranslations("Pricing");
  const tp = useTranslations("BusinessOnboarding.plan");
  const locale = useLocale();
  const number = new Intl.NumberFormat(locale);
  const market = useCanSubscribe();
  const plans = publicPlans(subscriptionPlans);
  const customHref = `https://wa.me/${CUSTOM_PLAN_WHATSAPP}?text=${encodeURIComponent(t("customMessage"))}`;

  return (
    <section aria-labelledby="onboarding-plans-title" className="grid gap-3">
      <div>
        <h3 id="onboarding-plans-title" className="text-base font-semibold tracking-tight text-(color:--ink)">{tp("pickerTitle")}</h3>
        <p className="mt-1 text-sm leading-relaxed text-(color:--ash-700)">{tp("pickerText")}</p>
        {market?.argentina ? <p className="mt-1 text-xs text-(color:--muted)">{t("paymentsNote")}</p> : null}
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {plans.map((plan) => {
          const price = t("planPrice", { price: number.format(plan.priceArs), currency: "ARS" });
          const current = plan.id === currentPlanId;
          return (
            <li key={plan.id} className={`${CARD} ${plan.featured ? "border-(color:--lime-dark) ring-1 ring-(--lime-dark)" : "border-(color:--line)"}`}>
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-base font-semibold tracking-tight text-(color:--ink)">{plan.name}</h4>
                {plan.featured ? <span className="rounded-full bg-(--lime) px-2.5 py-0.5 text-xs font-semibold text-(color:--ash-950)">{t("featuredBadge")}</span> : null}
              </div>
              <p className="flex flex-wrap items-baseline gap-x-1 text-(color:--ink)">
                <strong className="text-xl font-semibold tracking-tight">{price}</strong>
                <span className="text-sm text-(color:--muted)">{t("perMonth")}</span>
                <span className="basis-full text-xs text-(color:--muted)">{t("usdApprox", { price: number.format(plan.priceUsd) })}</span>
              </p>
              <ul className="grid gap-1.5 text-sm text-(color:--ash-700)">
                {[
                  t("planCredits", { credits: number.format(plan.credits) }),
                  t("planWhatsapp", { count: number.format(plan.limits.whatsappMonthly) }),
                  t("planEmail", { count: number.format(plan.limits.emailMonthly) }),
                  t("agentUsage", { plan: plan.id }),
                ].map((feature) => (
                  <li key={feature} className="flex items-start gap-2"><Check size={15} className="mt-0.5 shrink-0 text-(color:--lime-dark)" aria-hidden="true" />{feature}</li>
                ))}
              </ul>
              <div className="mt-auto pt-1">
                {current ? (
                  <p className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-(color:--lime-dark) bg-(--ash-50) text-sm font-semibold text-(color:--ink)" aria-current="true">
                    <Check size={16} aria-hidden="true" />{t("currentPlanLabel")}
                  </p>
                ) : market === null ? (
                  <p role="status" className="flex min-h-11 items-center justify-center gap-2 text-sm text-(color:--muted)">
                    <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />{tp("pickerLoading")}
                  </p>
                ) : market.canSubscribe ? (
                  <SubscribeButton planId={plan.id} label={`${plan.name} · ${price} ${t("perMonth")}`} />
                ) : (
                  <p className="border-t border-(color:--line) pt-3 text-sm leading-normal text-(color:--muted)">{t("customOnly")}</p>
                )}
              </div>
            </li>
          );
        })}
        <li className={`${CARD} border-(color:--line) sm:col-span-2`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="text-base font-semibold tracking-tight text-(color:--ink)">{t("customName")}</h4>
            <strong className="text-base font-semibold text-(color:--ink)">{t("customPrice")}</strong>
          </div>
          <p className="text-sm leading-relaxed text-(color:--ash-700)">{t("customText")}</p>
          <a
            href={customHref}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-(--ash-950) px-5 text-sm font-semibold text-(color:--paper) hover:bg-(--ash-800) ${FOCUS}`}
          >
            <FaWhatsapp size={17} aria-hidden="true" />{market?.argentina ? t("customCta") : t("customCtaInternational")}
          </a>
        </li>
      </ul>
    </section>
  );
}
