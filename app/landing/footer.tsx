import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { BrandLogo } from "@/app/brand-logo";

export async function LandingFooter() {
  const [t, legal] = await Promise.all([getTranslations("Landing.footer"), getTranslations("Legal")]);
  return (
    <footer className="lp-footer">
      <div className="lp-wrap lp-footer-inner">
        <BrandLogo />
        <p>{t("tagline")}</p>
        <nav className="lp-footer-links" aria-label={t("aria")}>
          <Link href="/pricing">{t("plans")}</Link>
          <Link href="/blog">{t("blog")}</Link>
          <Link href="/buscar">{t("login")}</Link>
          <Link href="/buscar?signup=1">{t("signup")}</Link>
          <Link href="/terminos">{legal("terms")}</Link>
          <Link href="/privacidad">{legal("privacy")}</Link>
        </nav>
      </div>
    </footer>
  );
}
