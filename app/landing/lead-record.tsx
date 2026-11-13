import { getTranslations } from "next-intl/server";
import { RadarFeed } from "./radar-feed";

type Lead = { name: string; rating: string; pain: string; service: string };
type Metric = { value: string; label: string };

export async function LeadRecord() {
  const t = await getTranslations("Landing.data");
  const leads = t.raw("leads") as Lead[];
  const metrics = t.raw("metrics") as Metric[];
  return (
    <section className="lp-section lp-wrap lp-split lp-radar-section" id="data" aria-labelledby="lp-data-title">
      <div className="lp-split-copy">
        <h2 id="lp-data-title">{t.rich("title", { mark: (chunks) => <mark>{chunks}</mark> })}</h2>
        <p className="lp-lead">{t("text")}</p>
        <ul className="lp-metrics">
          {metrics.map((metric) => (
            <li key={metric.label}>
              <strong>{metric.value}</strong>
              <span>{metric.label}</span>
            </li>
          ))}
        </ul>
      </div>
      <RadarFeed
        leads={leads}
        radarLabel={t("radarLabel")}
        range={t("range")}
        feedLabel={t("feedLabel")}
        serviceLabel={t("serviceLabel")}
      />
    </section>
  );
}
