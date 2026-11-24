import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { BrandLogo } from "@/app/brand-logo";
import { LanguageSwitcher } from "@/app/language-switcher";
import { HeaderCta } from "./header-cta";

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
          <li><Link href="/pricing" aria-current={current === "pricing" ? "page" : undefined}>{t("plans")}</Link></li>
          <li>{section("faq", t("faq"))}</li>
          <li><Link href="/blog" aria-current={current === "blog" ? "page" : undefined}>{t("blog")}</Link></li>
        </ul>
        <div className="lp-header-actions">
          <LanguageSwitcher />
          <HeaderCta />
        </div>
      </nav>
    </header>
  );
}
