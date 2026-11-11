import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { VerifyEmailPanel } from "@/app/auth-form";
import { BrandLogo, BrandMark } from "@/app/brand-logo";
import { LanguageSwitcher } from "@/app/language-switcher";
import "@/app/auth-steps.css";

export const metadata = {
  robots: { index: false, follow: false },
};

export default async function VerifyEmailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string | string[]; emailVerification?: string | string[] }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Verification");

  return (
    <main className="app-shell auth-shell">
      <header className="topbar">
        <BrandLogo />
        <LanguageSwitcher />
      </header>
      <div className="auth-workspace">
        <section className="search-panel auth-panel" aria-labelledby="verify-email-title">
          <BrandMark className="auth-brand-mark" />
          <Suspense fallback={<div role="status" aria-live="polite"><h1 id="verify-email-title">{t("loading")}</h1></div>}>
            <VerificationPanel locale={locale} searchParams={searchParams} />
          </Suspense>
        </section>
      </div>
    </main>
  );
}

async function VerificationPanel({
  locale,
  searchParams,
}: {
  locale: string;
  searchParams: Promise<{ token?: string | string[]; emailVerification?: string | string[] }>;
}) {
  const { token, emailVerification } = await searchParams;
  const initialResult = emailVerification === "verified" || emailVerification === "invalid" || emailVerification === "failed" ? emailVerification : undefined;
  return <VerifyEmailPanel token={typeof token === "string" ? token : ""} locale={locale} initialResult={initialResult} />;
}
