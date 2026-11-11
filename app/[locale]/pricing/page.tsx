import type { Metadata } from "next";
import PricingPage from "@/app/pricing/pricing-page";
import { PriceHero, PriceSections } from "@/app/pricing/pricing-sections";
import { getTranslations, setRequestLocale } from "next-intl/server";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Pricing" });
  return {
    title: locale === "en" ? "Plans and pricing | Leadta" : "Planes y precios | Leadta",
    description: `${t("from")} $15 USD/month, ${t("monthly")}`,
  };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <PricingPage locale={locale} hero={<PriceHero locale={locale} />}><PriceSections locale={locale} /></PricingPage>;
}
