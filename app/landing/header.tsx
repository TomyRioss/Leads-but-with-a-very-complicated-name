import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { BrandLogo } from "@/app/brand-logo";
import { LanguageSwitcher } from "@/app/language-switcher";

export async function LandingHeader() {
  const t = await getTranslations("Landing.nav");
  return (
    <header className="lp-header">
      <nav className="lp-header-inner lp-wrap" aria-label={t("aria")}>
        <BrandLogo />
        <ul className="lp-header-links">
          <li><a href="#how">{t("how")}</a></li>
          <li><a href="#data">{t("data")}</a></li>
          <li><a href="#pains">{t("pains")}</a></li>
          <li><a href="#plans">{t("plans")}</a></li>
          <li><a href="#faq">{t("faq")}</a></li>
        </ul>
        <div className="lp-header-actions">
          <LanguageSwitcher />
          <Link className="lp-btn lp-btn-ghost lp-btn-sm lp-hide-sm" href="/buscar">{t("login")}</Link>
          <Link className="lp-btn lp-btn-ink lp-btn-sm lp-show-sm" href="/buscar">{t("login")}</Link>
          <Link className="lp-btn lp-btn-ink lp-btn-sm lp-hide-sm" href="/buscar?signup=1">{t("signup")}</Link>
        </div>
      </nav>
    </header>
  );
}
