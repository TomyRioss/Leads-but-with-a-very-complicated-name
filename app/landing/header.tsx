import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { BrandLogo } from "@/app/brand-logo";
import { LanguageSwitcher } from "@/app/language-switcher";

type Current = "home" | "blog" | "pricing" | "other";

/** Header público compartido. En la landing los ítems son anchors; en el resto apuntan a la landing (con el locale) o a su ruta. */
export async function LandingHeader({ current = "home" }: { current?: Current }) {
  const t = await getTranslations("Landing.nav");
  const section = (hash: string, label: string) =>
    current === "home" ? <a href={`#${hash}`}>{label}</a> : <Link href={{ pathname: "/", hash }}>{label}</Link>;
  return (
    <header className="lp-header">
      <nav className="lp-header-inner lp-wrap" aria-label={t("aria")}>
        <BrandLogo />
        <ul className="lp-header-links">
          <li>{section("how", t("how"))}</li>
          <li>
            {current === "home"
              ? <a href="#plans">{t("plans")}</a>
              : <Link href="/pricing" aria-current={current === "pricing" ? "page" : undefined}>{t("plans")}</Link>}
          </li>
          <li>{section("faq", t("faq"))}</li>
          <li><Link href="/blog" aria-current={current === "blog" ? "page" : undefined}>{t("blog")}</Link></li>
        </ul>
        <div className="lp-header-actions">
          <LanguageSwitcher />
          <Link className="lp-btn lp-btn-ghost lp-btn-sm lp-hide-sm" href="/buscar">{t("login")}</Link>
          <Link className="lp-btn lp-btn-ink lp-btn-sm lp-show-sm" href="/buscar">{t("login")}</Link>
          <Link className="lp-btn lp-btn-lime lp-btn-sm lp-hide-sm" href="/buscar?signup=1">{t("signup")}</Link>
        </div>
      </nav>
    </header>
  );
}
