import { ArrowRight, BadgeCheck } from "lucide-react";
import { getTranslations } from "next-intl/server";
import "./pains.css";

type Row = { signal: string; pain: string; offer: string };

export async function PainsEnrichment() {
  const t = await getTranslations("Landing.pains");
  const rows = t.raw("rows") as Row[];
  const networks = t.raw("networks") as string[];
  return (
    <section className="lp-dark" id="pains" aria-labelledby="lp-pains-title">
      <div className="lp-wrap pn-inner">
        <div className="pn-head">
          <h2 id="lp-pains-title">{t("title")}</h2>
          <p className="lp-lead">{t("text")}</p>
        </div>
        <div>
          <div className="pn-head-row" aria-hidden="true">
            <span className="pn-k">{t("signalLabel")}</span>
            <span className="pn-k">{t("painLabel")}</span>
            <span className="pn-k">{t("offerLabel")}</span>
          </div>
          <ul className="pn-grid" aria-label={t("rowsLabel")}>
            {rows.map((row) => (
              <li className="pn-row" key={row.pain}>
                <div className="pn-cell">
                  <span className="pn-k">{t("signalLabel")}</span>
                  <span className="pn-signal">{row.signal}</span>
                </div>
                <ArrowRight className="pn-arrow" size={18} aria-hidden="true" />
                <div className="pn-cell">
                  <span className="pn-k">{t("painLabel")}</span>
                  <strong className="pn-pain">{row.pain}</strong>
                </div>
                <ArrowRight className="pn-arrow" size={18} aria-hidden="true" />
                <div className="pn-cell">
                  <span className="pn-k">{t("offerLabel")}</span>
                  <span className="pn-offer">{row.offer}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="pn-networks">
          <div>
            <h3>{t("enrichTitle")}</h3>
            <p>{t("enrichText")}</p>
          </div>
          <ul className="pn-chips">
            {networks.map((network) => (
              <li key={network}><BadgeCheck size={16} aria-hidden="true" />{network}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
