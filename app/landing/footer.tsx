import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { BrandLogo } from "@/app/brand-logo";

export async function LandingFooter() {
  const t = await getTranslations("Landing.footer");
  return (
    <footer className="lp-footer">
      <div className="lp-wrap lp-footer-inner">
        <BrandLogo />
        <p>{t("tagline")}</p>
        <nav className="lp-footer-links" aria-label={t("aria")}>
          <Link href="/pricing">{t("plans")}</Link>
          <Link href="/buscar">{t("login")}</Link>
          <Link href="/buscar?signup=1">{t("signup")}</Link>
        </nav>
      </div>
    </footer>
  );
}
