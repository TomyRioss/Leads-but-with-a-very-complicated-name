import type { Metadata } from "next";
import PricingPage from "@/app/pricing/pricing-page";
import { PriceHero, PriceSections } from "@/app/pricing/pricing-sections";
import { getTranslations, setRequestLocale } from "next-intl/server";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Pricing" });
  const url = locale === "es" ? "/pricing" : `/${locale}/pricing`;
  return {
    title: t("pageTitle"),
    description: t("metaDescription"),
    alternates: { canonical: url, languages: { es: "/pricing", en: "/en/pricing", "x-default": "/pricing" } },
    openGraph: { type: "website", siteName: "Leadta", url, title: t("pageTitle"), description: t("metaDescription"), locale: locale === "es" ? "es_AR" : "en_US" },
  };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <PricingPage hero={<PriceHero locale={locale} />}><PriceSections locale={locale} /></PricingPage>;
}
