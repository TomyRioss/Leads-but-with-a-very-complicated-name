import { ArrowRight, Check, Download, History, MapPin, Plus, Sparkles, Table2, Users } from "lucide-react";
import { FaWhatsapp } from "react-icons/fa";
import { SiGmail } from "react-icons/si";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { headers } from "next/headers";
import { isArgentinaMarket, marketCurrency } from "@/lib/market";
import { displayPrice, getPlanPrices } from "@/lib/server/rebill";
import { isDevEnvironment } from "@/lib/env-features";
import { CUSTOM_PLAN_WHATSAPP, publicPlans, subscriptionPlans } from "@/lib/plans";
import { CREDITS_PER_LEAD } from "@/lib/server/credits";
import { CurrencyProvider, CurrencyToggle, PlanAmount } from "./currency-toggle";
import { SubscribeButton } from "./subscribe-button";

/** Título con el punto final en lime, como el logo "Leadta.". */
function Dotted({ text }: { text: string }) {
  if (!text.endsWith(".")) return text;
  return <>{text.slice(0, -1)}<span className="price-dot" aria-hidden="true">.</span></>;
}

export async function MarketPricing({ locale }: { locale: string }) {
  const argentina = isArgentinaMarket(await headers());
  const showSubscribe = argentina || isDevEnvironment();
  return <PriceSections locale={locale} argentina={argentina} showSubscribe={showSubscribe} currency={marketCurrency(await headers())} />;
}

async function CallButton({ tone = "light", argentina }: { tone?: "light" | "dark"; argentina: boolean }) {
  const t = await getTranslations("Pricing");
  const message = argentina ? t("callMessage") : t("customMessage");
  const callHref = `https://wa.me/5491134083140?text=${encodeURIComponent(message)}`;
  return (
      <a className={`price-button price-button-${tone}`} href={callHref} target="_blank" rel="noreferrer">
      {argentina ? t("call") : t("customCtaInternational")}<ArrowRight size={16} aria-hidden="true" />
    </a>
  );
}

export async function PriceSections({ locale, argentina, showSubscribe, currency }: { locale: string; argentina: boolean; showSubscribe: boolean; currency: string }) {
  setRequestLocale(locale);
  const t = await getTranslations("Pricing");
  const number = new Intl.NumberFormat(locale);
  const prices = await getPlanPrices();
  const plans = publicPlans(subscriptionPlans).map((plan) => ({
    ...plan,
    price: displayPrice(prices, plan, currency),
    usdPrice: displayPrice(prices, plan, "USD"),
    features: [
      t("planCredits", { credits: number.format(plan.credits) }),
      t("planLeads", { leads: number.format(Math.floor(plan.credits / CREDITS_PER_LEAD)) }),
      t("planWhatsapp", { count: number.format(plan.limits.whatsappMonthly) }),
      t("planEmail", { count: number.format(plan.limits.emailMonthly) }),
      t("planScheduled", { count: number.format(plan.limits.scheduledMonthly) }),
      t("unlimitedAgent"),
    ],
  }));
  const localCurrency = plans[0]?.price.currency ?? "USD";
  const customHref = `https://wa.me/${CUSTOM_PLAN_WHATSAPP}?text=${encodeURIComponent(t("customMessage"))}`;
  const abroadHref = `https://wa.me/${CUSTOM_PLAN_WHATSAPP}?text=${encodeURIComponent(t("customMessage"))}`;
  const vibe = [
    { icon: Users, text: t("vibeLeads") },
    { icon: FaWhatsapp, text: t("vibeWhatsapp") },
    { icon: SiGmail, text: t("vibeEmail") },
  ];
  const included = [
    { icon: MapPin, title: t("mapsTitle"), text: t("mapsText") },
    { icon: Table2, title: t("sheetTitle"), text: t("sheetText") },
    { icon: Sparkles, title: t("painTitle"), text: t("painText") },
    { icon: History, title: t("historyTitle"), text: t("historyText") },
    { icon: Download, title: t("exportTitle"), text: t("exportText") },
    { icon: Check, title: t("supportTitle"), text: t("supportText") },
  ];
  const steps = [
    { title: t("tellVolume"), text: t("tellVolumeText") },
    { title: t("weBuildPlan"), text: t("weBuildPlanText") },
    { title: t("startSearching"), text: t("startSearchingText") },
  ];
  const faqs = [
    { q: t("faqCostQ"), a: argentina ? t("faqCostArgentina") : t("faqCostInternational") },
    { q: t("faqFeesQ"), a: t("faqFeesA") },
    { q: t("faqVolumeQ"), a: t("faqVolumeA") },
    { q: t("faqIncludedQ"), a: t("faqIncludedA") },
    { q: t("faqContractQ"), a: t("faqContractA") },
  ];
  return (
    <>
      <section className="price-band price-band-paper border-t-0!" aria-labelledby="price-plans">
        <CurrencyProvider>
        <div className="price-inner">
          <div className="price-head mx-auto max-w-none! text-center">
            <h1 id="price-plans"><Dotted text={t("plansTitle")} /></h1>
            {argentina ? <p className="price-plans-note">{t("paymentsNote")}</p> : null}
          </div>
          {localCurrency !== "USD" ? <CurrencyToggle local={localCurrency} label={t("currencyLabel")} /> : null}
          <ul className="price-plans">
            {plans.map((plan) => (
              <li key={plan.id} className={plan.featured ? "price-plan price-plan-featured" : "price-plan"}>
                <div className="price-plan-top">
                  <h3>{plan.name}</h3>
                  {plan.featured ? <span className="price-plan-badge">{t("featuredBadge")}</span> : null}
                </div>
                <p className="price-plan-amount">
                  <strong><PlanAmount
                    local={t("planPrice", { price: number.format(plan.price.amount), currency: plan.price.currency })}
                    usd={t("planPrice", { price: number.format(plan.usdPrice.amount), currency: "USD" })}
                  /></strong>
                  <span>{t("perMonth")}</span>
                </p>
                <ul className="price-plan-features">
                  {plan.features.map((feature) => (
                    <li key={feature}><Check size={16} aria-hidden="true" />{feature}</li>
                  ))}
                </ul>
                {showSubscribe ? <SubscribeButton planId={plan.id} label={`${plan.name} · ${t("planPrice", { price: number.format(plan.price.amount), currency: plan.price.currency })} ${t("perMonth")}`} /> : <p className="price-plan-unavailable">{t("customOnly")}</p>}
              </li>
            ))}
            <li className="price-plan">
              <div className="price-plan-top">
                <h3>{t("customName")}</h3>
              </div>
              <p className="price-plan-amount"><strong>{t("customPrice")}</strong></p>
              <p className="price-plan-text">{t("customText")}</p>
              <a className="price-button price-button-dark" href={argentina ? customHref : abroadHref} target="_blank" rel="noreferrer">
                {argentina ? t("customCta") : t("customCtaInternational")}<ArrowRight size={16} aria-hidden="true" />
              </a>
            </li>
          </ul>
        </div>
        </CurrencyProvider>
      </section>

      <section className="price-band" aria-labelledby="price-credits">
        <div className="price-inner grid gap-10">
          <h2 id="price-credits" className="m-0 whitespace-nowrap text-[clamp(26px,6.5vw,76px)] font-semibold leading-none tracking-[-.045em] text-(color:--ink)"><Dotted text={t("vibeTitle")} /></h2>
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
          <div className="price-head">
            <p className="price-kicker">{t("included")}</p>
            <h2 id="price-included"><Dotted text={t("includedTitle")} /></h2>
          </div>
          <ul className="price-included">
            {included.map(({ icon: Icon, title, text }) => (
              <li key={title}>
                <Icon size={20} aria-hidden="true" />
                <h3>{title}</h3>
                <p>{text}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="price-band" aria-labelledby="price-steps">
        <div className="price-inner">
          <div className="price-head">
            <p className="price-kicker">{t("planSteps")}</p>
            <h2 id="price-steps"><Dotted text={t("stepsTitle")} /></h2>
          </div>
          <ol className="price-steps">
            {steps.map((step, index) => (
              <li key={step.title}>
                <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="price-band price-band-paper" aria-labelledby="price-faq">
        <div className="price-inner price-split">
          <div className="price-head">
            <p className="price-kicker">{t("questions")}</p>
            <h2 id="price-faq"><Dotted text={t("faqTitle")} /></h2>
          </div>
          <div className="price-faq">
            {faqs.map((item) => (
              <details key={item.q}>
                <summary>{item.q}<Plus size={18} aria-hidden="true" /></summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="price-final" aria-labelledby="price-final-title">
        <div className="price-inner price-final-row">
          <h2 id="price-final-title"><Dotted text={t("talkVolume")} /></h2>
          <CallButton tone="dark" argentina={argentina} />
        </div>
      </section>
    </>
  );
}
