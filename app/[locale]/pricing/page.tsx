import type { Metadata } from "next";
import PricingPage from "@/app/pricing/pricing-page";
import { PriceHero, PriceSections } from "@/app/pricing/pricing-sections";
import { getTranslations, setRequestLocale } from "next-intl/server";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Pricing" });
  return {
    title: t("pageTitle"),
    description: t("metaDescription"),
  };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <PricingPage hero={<PriceHero locale={locale} />}><PriceSections locale={locale} /></PricingPage>;
}
