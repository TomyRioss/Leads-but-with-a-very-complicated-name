import { ArrowRight, Check, Download, History, MapPin, Plus, Sparkles, Table2 } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

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
        <p className="price-eyebrow">{t("from")}</p>
        <h1 id="price-title" className="price-amount">{t("price")}</h1>
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
      <section className="price-band" aria-labelledby="price-credits">
        <div className="price-inner price-split">
          <div className="price-head">
            <p className="price-kicker">{t("credits")}</p>
            <h2 id="price-credits">{t("leadCost")}</h2>
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
            <h2 id="price-included">{t("includedTitle")}</h2>
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
            <h2 id="price-steps">{t("stepsTitle")}</h2>
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
            <h2 id="price-faq">{t("faqTitle")}</h2>
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
          <h2 id="price-final-title">{t("talkVolume")}</h2>
          <CallButton tone="dark" />
        </div>
      </section>
    </>
  );
}
