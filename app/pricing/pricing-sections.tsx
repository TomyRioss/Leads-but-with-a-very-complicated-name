import { ArrowRight, Check, Download, History, MapPin, Plus, Sparkles, Table2 } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CUSTOM_PLAN_WHATSAPP, publicPlans, subscriptionPlans } from "@/lib/plans";
import { CREDITS_PER_LEAD } from "@/lib/server/credits";
import { SubscribeButton } from "./subscribe-button";

/** Título con el punto final en lime, como el logo "Leadta.". */
function Dotted({ text }: { text: string }) {
  if (!text.endsWith(".")) return text;
  return <>{text.slice(0, -1)}<span className="price-dot" aria-hidden="true">.</span></>;
}

async function CallButton({ tone = "light" }: { tone?: "light" | "dark" }) {
  const t = await getTranslations("Pricing");
  const callHref = `https://wa.me/5491134083140?text=${encodeURIComponent(t("callMessage"))}`;
  return (
      <a className={`price-button price-button-${tone}`} href={callHref} target="_blank" rel="noreferrer">
      {t("call")}<ArrowRight size={16} aria-hidden="true" />
    </a>
  );
}

export async function PriceHero({ locale }: { locale: string }) {
  setRequestLocale(locale);
  const t = await getTranslations("Pricing");
  return (
    <section className="price-hero" aria-labelledby="price-title">
      <div className="price-inner">
        <h1 id="price-title" className="sr-only">{t("pageTitle").split(" | ")[0]}</h1>
        <p className="price-eyebrow">{t("from")}</p>
        <p className="price-amount">{t("price")}</p>
        <p className="price-lede">{t("monthly")}</p>
        <div className="price-hero-row">
          <ul className="price-facts" aria-label={t("conditionsLabel")}>
            <li>{t("noSetup")}</li>
            <li>{t("noSeatPrice")}</li>
            <li>{t("monthlyPlan")}</li>
          </ul>
          <div className="price-hero-cta">
            <CallButton />
            <p>{t("supportNote")}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

export async function PriceSections({ locale }: { locale: string }) {
  setRequestLocale(locale);
  const t = await getTranslations("Pricing");
  const number = new Intl.NumberFormat(locale);
  const plans = publicPlans(subscriptionPlans).map((plan) => ({
    ...plan,
    features: [
      t("planCredits", { credits: number.format(plan.credits) }),
      t("planLeads", { leads: number.format(Math.floor(plan.credits / CREDITS_PER_LEAD)) }),
      t("planWhatsapp", { count: number.format(plan.limits.whatsappMonthly) }),
      t("planEmail", { count: number.format(plan.limits.emailMonthly) }),
      t("planScheduled", { count: number.format(plan.limits.scheduledMonthly) }),
    ],
  }));
  const customHref = `https://wa.me/${CUSTOM_PLAN_WHATSAPP}?text=${encodeURIComponent(t("customMessage"))}`;
  // Mercado Pago only charges in Argentina (ARS): Spanish shows ARS + checkout, English shows USD + contact.
  const argentina = locale === "es";
  const abroadHref = `https://wa.me/${CUSTOM_PLAN_WHATSAPP}?text=${encodeURIComponent(t("abroadMessage"))}`;
  const examples = [
    { credits: "100", leads: "50", note: t("trial") },
    { credits: "500", leads: "250", note: t("monthlyAreas") },
    { credits: "1,000", leads: "500", note: t("teamProspecting") },
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
    { q: t("faqCostQ"), a: t("faqCostA") },
    { q: t("faqFeesQ"), a: t("faqFeesA") },
    { q: t("faqVolumeQ"), a: t("faqVolumeA") },
    { q: t("faqIncludedQ"), a: t("faqIncludedA") },
    { q: t("faqContractQ"), a: t("faqContractA") },
  ];
  return (
    <>
      <section className="price-band price-band-paper" aria-labelledby="price-plans">
        <div className="price-inner">
          <div className="price-head">
            <p className="price-kicker">{t("plansKicker")}</p>
            <h2 id="price-plans"><Dotted text={t("plansTitle")} /></h2>
            <p>{t("plansText")}</p>
            <p className="price-plans-note">{t("paymentsNote")}</p>
          </div>
          <ul className="price-plans">
            {plans.map((plan) => (
              <li key={plan.id} className={plan.featured ? "price-plan price-plan-featured" : "price-plan"}>
                <div className="price-plan-top">
                  <h3>{plan.name}</h3>
                  {plan.featured ? <span className="price-plan-badge">{t("featuredBadge")}</span> : null}
                </div>
                <p className="price-plan-amount">
                  <strong>{t("planPrice", { price: number.format(argentina ? plan.priceArs : plan.priceUsd) })}</strong>
                  <span>{t("perMonth")}</span>
                </p>
                <ul className="price-plan-features">
                  {plan.features.map((feature) => (
                    <li key={feature}><Check size={16} aria-hidden="true" />{feature}</li>
                  ))}
                </ul>
                {argentina ? <SubscribeButton planId={plan.id} /> : (
                  <a className="price-button price-button-dark" href={abroadHref} target="_blank" rel="noreferrer">
                    {t("abroadCta")}<ArrowRight size={16} aria-hidden="true" />
                  </a>
                )}
              </li>
            ))}
            <li className="price-plan">
              <div className="price-plan-top">
                <h3>{t("customName")}</h3>
              </div>
              <p className="price-plan-amount"><strong>{t("customPrice")}</strong></p>
              <p className="price-plan-text">{t("customText")}</p>
              <a className="price-button price-button-dark" href={customHref} target="_blank" rel="noreferrer">
                {t("customCta")}<ArrowRight size={16} aria-hidden="true" />
              </a>
            </li>
          </ul>
        </div>
      </section>

      <section className="price-band" aria-labelledby="price-credits">
        <div className="price-inner price-split">
          <div className="price-head">
            <p className="price-kicker">{t("credits")}</p>
            <h2 id="price-credits"><Dotted text={t("leadCost")} /></h2>
            <p>{t("payAsYouGo")}</p>
          </div>
          <dl className="price-examples">
            {examples.map((item) => (
              <div key={item.credits}>
                <dt><strong>{item.credits}</strong> {t("creditUnit")}</dt>
                <dd><span>{t("upTo", { leads: item.leads })}</span>{item.note}</dd>
              </div>
            ))}
          </dl>
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
          <CallButton tone="dark" />
        </div>
      </section>
    </>
  );
}
