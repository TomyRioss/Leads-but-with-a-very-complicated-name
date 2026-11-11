import { ArrowRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LeadSheet } from "./lead-sheet";

export async function Hero() {
  const t = await getTranslations("Landing.hero");
  return (
    <section className="lp-hero lp-wrap" aria-labelledby="lp-hero-title">
      <div className="lp-hero-copy">
        <h1 id="lp-hero-title">{t("title")}</h1>
        <p className="lp-lead">{t("description")}</p>
        <div className="lp-hero-actions">
          <Link className="lp-btn lp-btn-ink" href="/buscar?signup=1">{t("primary")} <ArrowRight size={17} aria-hidden="true" /></Link>
          <Link className="lp-btn lp-btn-ghost" href="/buscar">{t("secondary")}</Link>
        </div>
        <p className="lp-hero-note">{t("note")}</p>
      </div>
      <LeadSheet />
    </section>
  );
}
