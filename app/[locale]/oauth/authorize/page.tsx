import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { BrandLogo } from "@/app/brand-logo";
import { LanguageSwitcher } from "@/app/language-switcher";
import { OAuthConsent } from "./oauth-consent";
import "@/app/auth-steps.css";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "oauth" });
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

// Shell estático: los parámetros OAuth y la sesión se leen en el cliente.
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <main className="app-shell auth-shell">
      <header className="topbar">
        <BrandLogo />
        <LanguageSwitcher />
      </header>
      <div className="auth-workspace">
        <section className="search-panel auth-panel oauth-panel" aria-labelledby="oauth-title">
          <Suspense><OAuthConsent /></Suspense>
        </section>
      </div>
    </main>
  );
}
