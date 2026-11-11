import { Check, Coins, Download, History } from "lucide-react";
import { getTranslations } from "next-intl/server";

type Batch = { date: string; query: string; count: string };
type CreditFact = { value: string; label: string };

export async function ExportHistory() {
  const t = await getTranslations("Landing.export");
  const points = t.raw("points") as string[];
  const batches = t.raw("batches") as Batch[];
  const credits = t.raw("credits") as CreditFact[];
  return (
    <section className="lp-section lp-wrap" aria-labelledby="lp-export-title">
      <div className="lp-split lp-split-reverse">
        <div className="lp-split-copy">
          <h2 id="lp-export-title">{t("title")}</h2>
          <p className="lp-lead">{t("text")}</p>
          <ul className="lp-points">
            {points.map((point) => (
              <li key={point}><Check size={18} aria-hidden="true" /><span>{point}</span></li>
            ))}
          </ul>
        </div>
        <div className="lp-history" role="group" aria-label={t("historyLabel")}>
          <div className="lp-history-head"><History size={16} aria-hidden="true" />{t("historyLabel")}</div>
          <ul>
            {batches.map((batch) => (
              <li key={batch.query}>
                <span className="lp-history-date">{batch.date}</span>
                <span className="lp-history-query"><strong>{batch.query}</strong><small>{batch.count}</small></span>
                <span className="lp-history-dl"><Download size={14} aria-hidden="true" />{t("download")}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="lp-credits">
        <h3><Coins size={18} aria-hidden="true" />{t("creditsTitle")}</h3>
        <ul>
          {credits.map((fact) => (
            <li key={fact.label}><strong>{fact.value}</strong> {fact.label}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
