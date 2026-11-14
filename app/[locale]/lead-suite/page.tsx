import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LeadSuiteSidebar } from "./lead-suite-sidebar";
import { LeadSuiteDashboard } from "./dashboard";
import "@/app/auth-steps.css";
import "./lead-suite.css";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "leadSuite" });
  return { title: t("title"), robots: { index: false, follow: false } };
}

// Shell estático: la sesión y los datos se piden en el cliente (/api/auth/me y /api/lead-suite/dashboard), así no bloquea el prerender.
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <div className="app-shell">
      <LeadSuiteSidebar />
      <LeadSuiteDashboard />
    </div>
  );
}
