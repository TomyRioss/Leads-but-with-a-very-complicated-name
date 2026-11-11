import { MapPin } from "lucide-react";
import { getTranslations } from "next-intl/server";

type Source = "search" | "analysis" | "enrichment";
type RecordField = { label: string; value: string; source: Source };

export async function LeadRecord() {
  const t = await getTranslations("Landing.data");
  const fields = t.raw("fields") as RecordField[];
  const sources: Source[] = ["search", "analysis", "enrichment"];
  return (
    <section className="lp-section lp-wrap lp-split" id="data" aria-labelledby="lp-data-title">
      <div className="lp-split-copy">
        <h2 id="lp-data-title">{t("title")}</h2>
        <p className="lp-lead">{t("text")}</p>
        <ul className="lp-legend">
          {sources.map((source) => (
            <li key={source}><span className={`lp-tag lp-tag-${source}`}>{t(`sources.${source}`)}</span></li>
          ))}
        </ul>
      </div>
      <article className="lp-record" aria-label={t("recordLabel")}>
        <header className="lp-record-head">
          <span className="lp-record-icon" aria-hidden="true"><MapPin size={20} /></span>
          <div>
            <h3>{t("recordName")}</h3>
            <p>{t("recordSubtitle")}</p>
          </div>
        </header>
        <dl className="lp-record-fields">
          {fields.map((field) => (
            <div key={field.label}>
              <dt>{field.label}</dt>
              <dd>{field.value}</dd>
              <dd className={`lp-tag lp-tag-${field.source}`}>{t(`sources.${field.source}`)}</dd>
            </div>
          ))}
        </dl>
      </article>
    </section>
  );
}
