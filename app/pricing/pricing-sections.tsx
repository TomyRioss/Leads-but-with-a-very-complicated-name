import type { ReactNode } from "react";
import { ArrowRight, Check, MapPin, MessageCircle, Sparkles, Users } from "lucide-react";
import { FaWhatsapp } from "react-icons/fa";
import { SiGmail } from "react-icons/si";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { headers } from "next/headers";
import { cache, Suspense } from "react";
import { isArgentinaMarket } from "@/lib/market";
import { isDevEnvironment } from "@/lib/env-features";
import { CUSTOM_PLAN_WHATSAPP, LEADTA_WHATSAPP, publicPlans, subscriptionPlans } from "@/lib/plans";
import { CREDITS_PER_LEAD } from "@/lib/server/credits";
import { SubscribeButton } from "./subscribe-button";

/** Título con el punto final en lime, como el logo "Leadta.". */
function Dotted({ text }: { text: string }) {
  if (!text.endsWith(".")) return text;
  return <>{text.slice(0, -1)}<span className="price-dot" aria-hidden="true">.</span></>;
}

/** Única lectura de headers() por request: solo lo que depende de Argentina queda dinámico, el resto entra al shell estático. */
const getMarket = cache(async () => {
  const argentina = isArgentinaMarket(await headers());
  return { argentina, showSubscribe: argentina || isDevEnvironment() };
});

/** Isla dinámica: renderiza lo que depende del mercado dentro de su propio Suspense. */
function Market({ children }: { children: (market: Awaited<ReturnType<typeof getMarket>>) => Promise<ReactNode> | ReactNode }) {
  return <Suspense fallback={null}><MarketSlot>{children}</MarketSlot></Suspense>;
}

async function MarketSlot({ children }: { children: (market: Awaited<ReturnType<typeof getMarket>>) => Promise<ReactNode> | ReactNode }) {
  return children(await getMarket());
}

async function CallButton({ tone = "light", argentina }: { tone?: "light" | "dark"; argentina: boolean }) {
  const t = await getTranslations("Pricing");
  const message = argentina ? t("callMessage") : t("customMessage");
  const callHref = `https://wa.me/${LEADTA_WHATSAPP}?text=${encodeURIComponent(message)}`;
  return (
      <a className={`price-button price-button-${tone}`} href={callHref} target="_blank" rel="noreferrer">
      {argentina ? t("call") : t("customCtaInternational")}<ArrowRight size={16} aria-hidden="true" />
    </a>
  );
}

export async function PriceSections({ locale }: { locale: string }) {
  setRequestLocale(locale);
  const t = await getTranslations("Pricing");
  const number = new Intl.NumberFormat(locale);
  const plans = publicPlans(subscriptionPlans).map((plan) => ({
    ...plan,
    // ARS principal y USD secundario para todos los visitantes, desde el catálogo.
    price: t("planPrice", { price: number.format(plan.priceArs), currency: "ARS" }),
    usdPrice: t("usdApprox", { price: number.format(plan.priceUsd) }),
    features: [
      t("planCredits", { credits: number.format(plan.credits) }),
      t("planLeads", { leads: number.format(Math.floor(plan.credits / CREDITS_PER_LEAD)) }),
      t("planWhatsapp", { count: number.format(plan.limits.whatsappMonthly) }),
      t("planEmail", { count: number.format(plan.limits.emailMonthly) }),
      t("planScheduled", { count: number.format(plan.limits.scheduledMonthly) }),
      t("agentUsage", { plan: plan.id }),
    ],
  }));
  const customHref = `https://wa.me/${CUSTOM_PLAN_WHATSAPP}?text=${encodeURIComponent(t("customMessage"))}`;
  const vibe = [
    { icon: Users, text: t("vibeLeads") },
    { icon: FaWhatsapp, text: t("vibeWhatsapp") },
    { icon: SiGmail, text: t("vibeEmail") },
  ];
  const flow = [
    { icon: MapPin, title: t("flowLeadsTitle"), text: t("flowLeadsText") },
    { icon: Sparkles, title: t("flowPainTitle"), text: t("flowPainText") },
    { icon: MessageCircle, title: t("flowContactTitle"), text: t("flowContactText") },
  ];
  return (
    <>
      <section className="price-band price-band-paper border-t-0!" aria-labelledby="price-plans">
        <div className="price-inner">
          <div className="price-head mx-auto max-w-none! text-center">
            <h1 id="price-plans"><Dotted text={t("plansTitle")} /></h1>
            <Market>{({ argentina }) => argentina ? <p className="price-plans-note">{t("paymentsNote")}</p> : null}</Market>
          </div>
          <ul className="price-plans">
            {plans.map((plan) => (
              <li key={plan.id} className={plan.featured ? "price-plan price-plan-featured" : "price-plan"}>
                <div className="price-plan-top">
                  {/* h2 con la métrica del h3 original (.price-plan h3): .lp-page h2 no debe cambiar el tamaño. */}
                  <h2 className="text-[20px]! font-[680]! leading-[1.3]! tracking-[-.03em]!">{plan.name}</h2>
                  {plan.featured ? <span className="price-plan-badge">{t("featuredBadge")}</span> : null}
                </div>
                <p className="price-plan-amount">
                  <strong>{plan.price}</strong>
                  <span>{t("perMonth")}</span>
                  <span className="basis-full">{plan.usdPrice}</span>
                </p>
                <ul className="price-plan-features">
                  {plan.features.map((feature) => (
                    <li key={feature}><Check size={16} aria-hidden="true" />{feature}</li>
                  ))}
                </ul>
                <Market>{({ showSubscribe }) => showSubscribe ? <SubscribeButton planId={plan.id} label={`${plan.name} · ${plan.price} ${t("perMonth")}`} /> : <p className="price-plan-unavailable">{t("customOnly")}</p>}</Market>
              </li>
            ))}
            <li className="price-plan">
              <div className="price-plan-top">
                <h2 className="text-[20px]! font-[680]! leading-[1.3]! tracking-[-.03em]!">{t("customName")}</h2>
              </div>
              <p className="price-plan-amount"><strong>{t("customPrice")}</strong></p>
              <p className="price-plan-text">{t("customText")}</p>
              <Market>{({ argentina }) => (
                <a className="price-button price-button-dark" href={customHref} target="_blank" rel="noreferrer">
                  {argentina ? t("customCta") : t("customCtaInternational")}<ArrowRight size={16} aria-hidden="true" />
                </a>
              )}</Market>
            </li>
          </ul>
        </div>
      </section>

      <section className="price-band" aria-labelledby="price-credits">
        <div className="price-inner grid gap-10 md:grid-cols-2 md:items-center md:gap-16">
          <h2 id="price-credits" className="m-0 whitespace-nowrap text-[clamp(26px,6.5vw,76px)] font-semibold md:whitespace-normal md:text-balance leading-none tracking-[-.045em] text-(color:--ink)"><Dotted text={t("vibeTitle")} /></h2>
          <ul className="grid">
            {vibe.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-4 border-t border-(--ash-300) py-[22px] text-lg font-semibold tracking-tight text-(color:--ink) last:border-b">
                <Icon size={24} aria-hidden="true" className="shrink-0" />
                {text}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="price-band price-band-paper" aria-labelledby="price-included">
        <div className="price-inner">
          <div className="price-head max-w-[720px]!">
            <h2 id="price-included"><Dotted text={t("flowTitle")} /></h2>
            <p>{t("flowText")}</p>
          </div>
          <ol className="mt-10 grid gap-4 p-0 md:mt-14 md:grid-cols-3 md:gap-12">
            {flow.map(({ icon: Icon, title, text }, index) => (
              <li key={title} className="relative flex flex-col gap-3 rounded-2xl border border-(--line) bg-(--ash-50) p-6">
                <div className="flex items-center justify-between">
                  <span aria-hidden="true" className="grid size-10 place-items-center rounded-[10px] bg-(--ash-950) text-(color:--lime)"><Icon size={20} /></span>
                  <span aria-hidden="true" className="rounded-full bg-(--lime) px-2.5 py-0.5 text-sm font-semibold text-(color:--ash-950)">{String(index + 1).padStart(2, "0")}</span>
                </div>
                <h3 className="m-0 text-lg font-semibold tracking-tight text-(color:--ink)">{title}</h3>
                <p className="m-0 text-[15px] leading-relaxed text-(color:--muted)">{text}</p>
                {index < flow.length - 1 ? <ArrowRight size={24} aria-hidden="true" className="absolute top-1/2 -right-9 hidden -translate-y-1/2 text-(color:--lime-dark) md:block" /> : null}
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="price-final" aria-labelledby="price-final-title">
        <div className="price-inner price-final-row">
          <h2 id="price-final-title"><Dotted text={t("talkVolume")} /></h2>
          <Market>{({ argentina }) => <CallButton tone="dark" argentina={argentina} />}</Market>
        </div>
      </section>
    </>
  );
}
