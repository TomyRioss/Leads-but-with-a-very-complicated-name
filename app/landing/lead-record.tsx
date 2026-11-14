import { getTranslations } from "next-intl/server";
import { LiveMetrics } from "./live-metrics";
import { RadarFeed } from "./radar-feed";

type Lead = { name: string; rating: string; pain: string; service: string };

export async function LeadRecord() {
  const t = await getTranslations("Landing.data");
  const leads = t.raw("leads") as Lead[];
  return (
    <section className="lp-section lp-wrap lp-split lp-radar-section" id="data" aria-labelledby="lp-data-title">
      <div className="lp-split-copy">
        <h2 id="lp-data-title">{t.rich("title", { mark: (chunks) => <mark>{chunks}</mark> })}</h2>
        <p className="lp-lead">{t("text")}</p>
        <LiveMetrics labels={{ leads: t("metrics.leads"), pains: t("metrics.pains"), categories: t("metrics.categories") }} />
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
