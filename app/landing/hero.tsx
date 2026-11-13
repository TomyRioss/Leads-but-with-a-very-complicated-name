import { ArrowRight, Phone } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LeadSheet } from "./lead-sheet";

export async function Hero() {
  const t = await getTranslations("Landing.hero");
  return (
    <section className="lp-hero lp-wrap" aria-labelledby="lp-hero-title">
      <div className="lp-hero-copy">
        <h1 id="lp-hero-title">{t.rich("title", { mark: (chunks) => <mark>{chunks}</mark> })}</h1>
        <p className="lp-lead">{t.rich("description", { strong: (chunks) => <strong>{chunks}</strong> })}</p>
        <div className="lp-hero-actions">
          <a
            className="lp-btn lp-btn-lime"
            href={`https://wa.me/5491134083140?text=${encodeURIComponent(t("demoMessage"))}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("demo")} <Phone size={17} aria-hidden="true" />
          </a>
          <Link className="lp-btn lp-btn-ghost" href="/buscar?signup=1">{t("primary")} <ArrowRight size={17} aria-hidden="true" /></Link>
        </div>
      </div>
      <LeadSheet />
    </section>
  );
}
