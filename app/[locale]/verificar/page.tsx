import Link from "next/link";
import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { BrandLogo, BrandMark } from "@/app/brand-logo";
import { LanguageSwitcher } from "@/app/language-switcher";

export const metadata = {
  robots: { index: false, follow: false },
};

export default async function VerifyEmailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string | string[] }>;
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
          <h1 id="verify-email-title">{t("title")}</h1>
          <Suspense fallback={<p className="auth-intro" aria-live="polite">{t("description")}</p>}>
            <VerificationForm locale={locale} searchParams={searchParams} />
          </Suspense>
          <p className="field-help verification-footnote">{t("privacy")}</p>
        </section>
      </div>
    </main>
  );
}

async function VerificationForm({
  locale,
  searchParams,
}: {
  locale: string;
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const [{ token }, t] = await Promise.all([searchParams, getTranslations("Verification")]);
  const verificationToken = typeof token === "string" ? token : "";

  return (
    <>
      <p className="auth-intro">{verificationToken ? t("description") : t("invalid")}</p>
      {verificationToken ? (
        <form className="auth-fields" action="/api/auth/verify-email" method="post">
          <input type="hidden" name="token" value={verificationToken} />
          <input type="hidden" name="locale" value={locale} />
          <button className="primary-button auth-submit" type="submit">{t("button")}</button>
        </form>
      ) : (
        <p className="auth-switch"><Link href="/buscar?signup=1">{t("title")}</Link></p>
      )}
    </>
  );
}
