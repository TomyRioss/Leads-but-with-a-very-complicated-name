import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PricingHero } from "@/app/pricing-hero";
import { ExportHistory } from "@/app/landing/export-history";
import { Faq } from "@/app/landing/faq";
import { FinalCta } from "@/app/landing/final-cta";
import { LandingFooter } from "@/app/landing/footer";
import { LandingHeader } from "@/app/landing/header";
import { Hero } from "@/app/landing/hero";
import { HowItWorks } from "@/app/landing/how-it-works";
import { LeadRecord } from "@/app/landing/lead-record";
import { PainsEnrichment } from "@/app/landing/pains-enrichment";
import "@/app/landing/landing.css";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Landing.meta" });
  return { title: t("title"), description: t("description") };
}

export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <div className="lp-page">
      <LandingHeader />
      <main>
        <Hero />
        <HowItWorks />
        <LeadRecord />
        <PainsEnrichment />
        <ExportHistory />
        <PricingHero variant="landing" id="plans" locale={locale} />
        <Faq />
        <FinalCta />
      </main>
      <LandingFooter />
    </div>
  );
}
