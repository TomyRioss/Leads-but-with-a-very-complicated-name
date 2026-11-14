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
import { WhatsappFloat } from "@/app/landing/whatsapp-float";
import { SignupPopup } from "@/app/landing/signup-popup";
import "@/app/landing/landing.css";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Landing.meta" });
  const url = locale === "es" ? "/" : `/${locale}`;
  return {
    title: t("title"),
    description: t("description"),
    alternates: { canonical: url, languages: { es: "/", en: "/en", "x-default": "/" } },
    openGraph: { type: "website", siteName: "Leadta", url, title: t("title"), description: t("description"), locale: locale === "es" ? "es_AR" : "en_US" },
  };
}

async function structuredData(locale: string) {
  const [meta, faq] = await Promise.all([
    getTranslations({ locale, namespace: "Landing.meta" }),
    getTranslations({ locale, namespace: "Landing.faq" }),
  ]);
  const origin = new URL(process.env.APP_URL?.trim() || "https://leadta.app").origin;
  const url = locale === "es" ? `${origin}/` : `${origin}/${locale}`;
  const organization = { "@type": "Organization", "@id": `${origin}/#organization`, name: "Leadta", url: `${origin}/`, logo: `${origin}/favicon.ico` };
  return {
    "@context": "https://schema.org",
    "@graph": [
      organization,
      { "@type": "WebSite", "@id": `${origin}/#website`, name: "Leadta", url: `${origin}/`, inLanguage: ["es", "en"], publisher: { "@id": organization["@id"] } },
      {
        "@type": "SoftwareApplication",
        name: "Leadta",
        url,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        description: meta("description"),
        inLanguage: locale,
        publisher: { "@id": organization["@id"] },
        offers: { "@type": "Offer", price: "15", priceCurrency: "USD", url: `${origin}${locale === "es" ? "" : "/en"}/pricing` },
      },
      {
        "@type": "FAQPage",
        inLanguage: locale,
        mainEntity: (faq.raw("items") as { q: string; a: string }[]).map((item) => ({ "@type": "Question", name: item.q, acceptedAnswer: { "@type": "Answer", text: item.a } })),
      },
    ],
  };
}

export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [wa, jsonLd] = await Promise.all([getTranslations({ locale, namespace: "Landing.whatsapp" }), structuredData(locale)]);
  return (
    <div className="lp-page">
      {/* Escapa "<" para que el contenido traducido no pueda cerrar el script. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
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
      <SignupPopup />
      <WhatsappFloat hello={wa("hello")} text={wa("text")} prefill={wa("prefill")} openLabel={wa("open")} closeLabel={wa("close")} />
    </div>
  );
}
