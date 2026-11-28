import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LandingFooter } from "@/app/landing/footer";
import { LandingHeader } from "@/app/landing/header";
import { Hero } from "@/app/landing/hero";
import { HowItWorks } from "@/app/landing/how-it-works";
import { ThreeThings } from "@/app/landing/three-things";
import { ClosingCta } from "@/app/landing/closing-cta";
import { WhatsappFloat } from "@/app/landing/whatsapp-float";
import { SignupPopup } from "@/app/landing/signup-popup";
import { publicPlans, subscriptionPlans } from "@/lib/plans";
import "@/app/landing/landing.css";

export const instant = false;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Landing.meta" });
  const url = locale === "es" ? "/" : `/${locale}`;
  return {
    title: t("title"),
    description: t("description"),
    alternates: { canonical: url, languages: { es: "/", en: "/en", "x-default": "/" }, types: { "text/markdown": "/llms-full.txt" } },
    openGraph: { type: "website", siteName: "Leadta", url, title: t("title"), description: t("description"), locale: locale === "es" ? "es_AR" : "en_US" },
  };
}

async function structuredData(locale: string) {
  const meta = await getTranslations({ locale, namespace: "Landing.meta" });
  const origin = new URL(process.env.APP_URL?.trim() || "https://leadta.app").origin;
  const url = locale === "es" ? `${origin}/` : `${origin}/${locale}`;
  // Precio "desde": el plan público más barato del catálogo.
  const fromPrice = Math.min(...publicPlans(subscriptionPlans).map((plan) => plan.priceUsd));
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
        offers: { "@type": "Offer", price: String(fromPrice), priceCurrency: "USD", url: `${origin}${locale === "es" ? "" : "/en"}/pricing` },
      }
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
        <ThreeThings />
        <ClosingCta />
      </main>
      <LandingFooter />
      <SignupPopup />
      <WhatsappFloat hello={wa("hello")} text={wa("text")} prefill={wa("prefill")} openLabel={wa("open")} closeLabel={wa("close")} />
    </div>
  );
}
