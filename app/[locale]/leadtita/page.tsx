import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LeadSuiteSidebar } from "@/app/[locale]/lead-suite/lead-suite-sidebar";
import { LeadtitaChat } from "./leadtita-chat";
import "./leadtita.css";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "leadSuiteChat" });
  return { title: t("pageTitle"), robots: { index: false, follow: false } };
}

// Shell estático: la sesión se resuelve en el cliente (getSession/peekSessionUser), igual que lead-suite y personas.
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <div className="app-shell">
      <LeadSuiteSidebar active="leadtita" />
      <main className="leadtita-main">
        <LeadtitaChat />
      </main>
    </div>
  );
}
