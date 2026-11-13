import type { CSSProperties } from "react";
import { FileSpreadsheet, Search, Star } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { PainReveal } from "./pain-reveal";

type SheetRow = {
  name: string;
  category: string;
  rating: string;
  reviews: string;
  phone: string;
  email: string;
  socials: string;
  pain: string;
  service: string;
};

export async function LeadSheet() {
  const t = await getTranslations("Landing.sheet");
  const rows = t.raw("rows") as SheetRow[];
  const missing = t("missing");
  const value = (text: string) => (text ? <span>{text}</span> : <span className="lp-missing">{missing}</span>);

  return (
    <figure className="lp-sheet" aria-label={t("caption")}>
      <div className="lp-sheet-bar">
        <span className="lp-sheet-search">
          <Search size={16} aria-hidden="true" />
          <span className="lp-sheet-search-text">
            <small>{t("searchLabel")}</small>
            <strong>{t("query")}</strong>
          </span>
        </span>
        <span className="lp-sheet-count">{t("count")}</span>
        <span className="lp-sheet-exports">
          <FileSpreadsheet size={14} aria-hidden="true" />
          {t("csv")} · {t("xlsx")}
        </span>
      </div>
      <table className="lp-table">
        <thead>
          <tr>
            <th scope="col">{t("cols.business")}</th>
            <th scope="col">{t("cols.phone")}</th>
            <th scope="col">{t("cols.email")}</th>
            <th scope="col" className="lp-col-socials">{t("cols.socials")}</th>
            <th scope="col">{t("cols.pain")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.name} style={{ "--i": index } as CSSProperties}>
              <td className="lp-cell-business">
                <strong>{row.name}</strong>
                <small>
                  {row.category} · <Star size={12} aria-hidden="true" /> <span className="sr-only">{t("cols.reviews")} </span>{row.rating} ({row.reviews})
                </small>
              </td>
              <td data-label={t("cols.phone")}>{value(row.phone)}</td>
              <td data-label={t("cols.email")}>{value(row.email)}</td>
              <td data-label={t("cols.socials")} className="lp-col-socials">{value(row.socials)}</td>
              <td data-label={t("cols.pain")}>{row.pain ? (
                <span className="lp-pain-cell">
                  <span className="lp-pain-chip">{row.pain}</span>
                  <small className="lp-service"><b>{t("serviceLabel")}</b> {row.service}</small>
                </span>
              ) : (
                <PainReveal label={t("analyzePain")} result={t("analyzedPain")} serviceLabel={t("serviceLabel")} service={t("analyzedService")} />
              )}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <figcaption className="lp-sheet-foot">{t("sample")}</figcaption>
    </figure>
  );
}
