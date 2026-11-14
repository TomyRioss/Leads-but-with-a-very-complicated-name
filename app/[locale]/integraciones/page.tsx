import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LeadSuiteSidebar } from "@/app/[locale]/lead-suite/lead-suite-sidebar";
import { IntegrationsView } from "./integrations-view";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "integrations" });
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

// Shell estático: la sesión y el estado de Google se piden en el cliente.
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "integrations" });
  return (
    <div className="app-shell">
      <LeadSuiteSidebar active="integrations" />
      <main className="integrations-main">
        <h1>{t("title")}<span className="integrations-dot" aria-hidden="true">.</span></h1>
        <p className="integrations-lede">{t("lede")}</p>
        <Suspense><IntegrationsView /></Suspense>
      </main>
    </div>
  );
}
