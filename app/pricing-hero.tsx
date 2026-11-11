import { ArrowRight } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

export async function PricingHero({ variant, id, locale }: { variant: "landing" | "page"; id?: string; locale: string }) {
  setRequestLocale(locale);
  const t = await getTranslations("Pricing");
  const Title = variant === "page" ? "h1" : "h2";
  const callHref = `https://wa.me/5491134083140?text=${encodeURIComponent(locale === "en" ? "Hello, I'd like to schedule a call to learn about Leadta plans." : "Hola, quiero agendar una llamada para conocer los planes de Leadta.")}`;
  return (
    <section className={`pricing-hero pricing-hero-${variant}`} id={id} aria-labelledby="pricing-title">
      <div className="pricing-hero-inner">
        <p className="pricing-eyebrow">{t("from")}</p>
        <Title id="pricing-title" className="pricing-hero-price">$15 USD/mes</Title>
        <p className="pricing-hero-sub">{t("monthly")}</p>
        <div className="pricing-hero-rule" aria-hidden="true" />
        <div className="pricing-hero-foot">
          <p>{t("noSetup")}. {t("noSeatPrice")}. {locale === "en" ? "Pay for the leads you actually search for. We tailor the plan to your monthly volume." : "Pagás por los leads que realmente buscás. Ajustamos el plan a tu volumen mensual."}</p>
          <div className="pricing-hero-cta">
            <a className="pricing-hero-button" href={callHref} target="_blank" rel="noreferrer">{t("call")}<ArrowRight size={16} aria-hidden="true" /></a>
            <p className="pricing-hero-note">{t("supportNote")}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
