import { ArrowRight } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

export async function PricingHero({ variant, id, locale }: { variant: "landing" | "page"; id?: string; locale: string }) {
  setRequestLocale(locale);
  const t = await getTranslations("Pricing");
  const Title = variant === "page" ? "h1" : "h2";
  const callHref = `https://wa.me/5491134083140?text=${encodeURIComponent(t("callMessage"))}`;
  return (
    <section className={`pricing-hero pricing-hero-${variant}`} id={id} aria-labelledby="pricing-title">
      <div className="pricing-hero-inner">
        <p className="pricing-eyebrow">{t("from")}</p>
        <Title id="pricing-title" className="pricing-hero-price">{t("price")}</Title>
        <p className="pricing-hero-sub">{t("monthly")}</p>
        <div className="pricing-hero-rule" aria-hidden="true" />
        <div className="pricing-hero-foot">
          <p>{t("noSetup")}. {t("noSeatPrice")}. {t("heroPitch")}</p>
          <div className="pricing-hero-cta">
            <a className="pricing-hero-button" href={callHref} target="_blank" rel="noreferrer">{t("call")}<ArrowRight size={16} aria-hidden="true" /></a>
            <p className="pricing-hero-note">{t("supportNote")}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
