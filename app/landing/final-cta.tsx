import { ArrowRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export async function FinalCta() {
  const t = await getTranslations("Landing.cta");
  return (
    <section className="lp-final" aria-labelledby="lp-final-title">
      <div className="lp-wrap lp-final-inner">
        <div>
          <h2 id="lp-final-title">{t("title")}</h2>
          <p>{t("text")}</p>
        </div>
        <div className="lp-final-actions">
          <Link className="lp-btn lp-btn-ink" href="/buscar?signup=1">{t("primary")} <ArrowRight size={17} aria-hidden="true" /></Link>
          <Link className="lp-final-link" href="/buscar">{t("secondary")}</Link>
        </div>
      </div>
    </section>
  );
}
