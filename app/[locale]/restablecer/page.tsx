import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ResetPasswordPanel } from "@/app/auth-form";
import { BrandLogo, BrandMark } from "@/app/brand-logo";
import { LanguageSwitcher } from "@/app/language-switcher";
import "@/app/auth-steps.css";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Auth" });
  return { title: t("resetPageTitle") };
}

export default async function ResetPasswordPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <main className="app-shell auth-shell">
      <header className="topbar">
        <BrandLogo />
        <LanguageSwitcher />
      </header>
      <div className="auth-workspace">
        <section className="search-panel auth-panel" aria-labelledby="reset-password-title">
          <BrandMark className="auth-brand-mark" />
          <Suspense fallback={null}>
            <ResetPanel locale={locale} searchParams={searchParams} />
          </Suspense>
        </section>
      </div>
    </main>
  );
}

async function ResetPanel({ locale, searchParams }: { locale: string; searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  return <ResetPasswordPanel token={typeof token === "string" ? token : ""} locale={locale} />;
}
