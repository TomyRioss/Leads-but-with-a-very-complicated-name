import type { Metadata } from "next";
import PricingPage from "@/app/pricing/pricing-page";
import { PriceSections } from "@/app/pricing/pricing-sections";
import { publicPlans, subscriptionPlans } from "@/lib/plans";
import { getTranslations, setRequestLocale } from "next-intl/server";

export const instant = false;

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

/** Offers desde el catálogo real: el precio principal que ve todo visitante es ARS. */
async function structuredData(locale: string) {
  const [t, footer] = await Promise.all([getTranslations({ locale, namespace: "Pricing" }), getTranslations({ locale, namespace: "Landing.footer" })]);
  const origin = new URL(process.env.APP_URL?.trim() || "https://leadta.app").origin;
  const home = locale === "es" ? `${origin}/` : `${origin}/${locale}`;
  const url = `${origin}${locale === "es" ? "" : `/${locale}`}/pricing`;
  return [
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "Leadta",
      url,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      description: t("metaDescription"),
      inLanguage: locale,
      offers: publicPlans(subscriptionPlans).map((plan) => ({ "@type": "Offer", name: plan.name, price: String(plan.priceArs), priceCurrency: "ARS", url })),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Leadta", item: home },
        { "@type": "ListItem", position: 2, name: footer("plans"), item: url },
      ],
    },
  ];
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const jsonLd = await structuredData(locale);
  return (
    <PricingPage hero={null}>
      {/* Escapa "<" para que el contenido traducido no pueda cerrar el script. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <PriceSections locale={locale} />
    </PricingPage>
  );
}
