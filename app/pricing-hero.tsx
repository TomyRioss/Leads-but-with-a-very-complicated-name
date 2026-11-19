import { ArrowRight } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { headers } from "next/headers";
import { isArgentinaMarket } from "@/lib/market";

export async function PricingHero({ variant, id, locale, argentina }: { variant: "landing" | "page"; id?: string; locale: string; argentina: boolean }) {
  setRequestLocale(locale);
  const t = await getTranslations("Pricing");
  const Title = variant === "page" ? "h1" : "h2";
  const format = new Intl.NumberFormat(locale);
  const price = argentina
    ? t("planPriceArs", { price: format.format(15_000) })
    : t("planPriceUsd", { price: format.format(10) });
  const callHref = `https://wa.me/5491134083140?text=${encodeURIComponent(argentina ? t("callMessage") : t("customMessage"))}`;
  return (
    <section className={`pricing-hero pricing-hero-${variant}`} id={id} aria-labelledby="pricing-title">
      <div className="pricing-hero-inner">
        <p className="pricing-eyebrow">{t("from")}</p>
        <Title id="pricing-title" className="pricing-hero-price">{price}</Title>
        <p className="pricing-hero-sub">{t("monthly")}</p>
        <div className="pricing-hero-rule" aria-hidden="true" />
        <div className="pricing-hero-foot">
            <p>{t("noSetup")}. {t("noSeatPrice")}. {argentina ? t("heroPitch") : t("customOnly")}</p>
          <div className="pricing-hero-cta">
            <a className="pricing-hero-button" href={callHref} target="_blank" rel="noreferrer">{argentina ? t("call") : t("customCtaInternational")}<ArrowRight size={16} aria-hidden="true" /></a>
            <p className="pricing-hero-note">{argentina ? t("supportNote") : t("customOnly")}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

export async function MarketPricingHero({ variant, id, locale }: { variant: "landing" | "page"; id?: string; locale: string }) {
  const argentina = isArgentinaMarket(await headers());
  return <PricingHero variant={variant} id={id} locale={locale} argentina={argentina} />;
}
