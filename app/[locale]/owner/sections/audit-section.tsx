"use client";

import {
  auditActions, errorBox, stateBox, tableClass, tableWrap, tdClass, theadClass,
  thClass, trClass, useOwnerFormat, useOwnerList,
} from "../ui";
import { ListToolbar, Pager } from "./list-controls";
import { useTranslations } from "next-intl";

type AuditItem = {
  id: string;
  actorEmail: string;
  action: string;
  targetType: string;
  targetId: string;
  targetLabel: string;
  details: unknown;
  ip: string;
  created: string;
};


export default function AuditSection({ onUnauthorized }: { onUnauthorized: () => void }) {
  const t = useTranslations("Owner.audit");
  const common = useTranslations("Owner.common");
  const { actionLabel, describeDetails, formatDateTime } = useOwnerFormat();
  const actionOptions = auditActions.map((value) => ({ value, label: actionLabel(value) }));
  const list = useOwnerList<AuditItem>("/api/owner/audit", t("loadError"), onUnauthorized, "action");
  const { data, loading, error } = list;

  return (
    <section aria-label={t("title")}>
      <ListToolbar title={t("title")} total={data?.totalItems} query={list.query} onQuery={list.setQuery} queryLabel={t("searchLabel")} status={list.status} onStatus={list.setStatus} statusLabel={t("filterAction")} allLabel={t("allActions")} statusOptions={actionOptions} onRefresh={() => void list.reload()} />
      {error && <p className={errorBox} role="alert">{error}</p>}
      <div className={`${tableWrap}${loading ? " opacity-60 transition-opacity" : ""}`} aria-busy={loading}>
        <table className={tableClass}>
          <thead className={theadClass}>
            <tr>
              <th className={thClass} scope="col">{t("dateTime")}</th>
              <th className={thClass} scope="col">{t("who")}</th>
              <th className={thClass} scope="col">{t("action")}</th>
              <th className={thClass} scope="col">{t("target")}</th>
              <th className={thClass} scope="col">{t("detail")}</th>
              <th className={thClass} scope="col">{t("ip")}</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((entry) => {
              const rows = describeDetails(entry.details);
              return (
                <tr className={`${trClass} align-top`} key={entry.id}>
                  <td className={`${tdClass} whitespace-nowrap`} data-label={t("dateTime")}>{formatDateTime(entry.created)}</td>
                  <td className={`${tdClass} break-all`} data-label={t("who")}>{entry.actorEmail || "—"}</td>
                  <td className={`${tdClass} font-semibold`} data-label={t("action")}>{actionLabel(entry.action)}</td>
                  <td className={`${tdClass} break-all`} data-label={t("target")}>{entry.targetLabel || "—"}</td>
                  <td className={`${tdClass} max-md:block max-md:text-left`} data-label={t("detail")}>
                    {rows.length === 0 ? <span className="text-xs text-(color:--muted)">{t("noDetails")}</span> : (
                      <details className="group text-xs">
                        <summary className="cursor-pointer select-none font-semibold underline underline-offset-[3px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(color:--ash-950)">{t("viewDetails")}</summary>
                        <dl className="m-0 mt-2 grid gap-1">
                          {rows.map(([label, value]) => (
                            <div className="grid grid-cols-[minmax(0,9rem)_1fr] gap-2" key={label}><dt className="text-(color:--muted)">{label}</dt><dd className="m-0 break-words">{value}</dd></div>
                          ))}
                        </dl>
                      </details>
                    )}
                  </td>
                  <td className={`${tdClass} text-xs`} data-label={t("ip")}>{entry.ip || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!data && loading && <p className={stateBox} role="status">{t("loading")}</p>}
        {data && data.items.length === 0 && !loading && <p className={stateBox}>{list.query || list.status ? common("noResultsFilter") : t("empty")}</p>}
      </div>
      <Pager page={list.page} totalPages={data?.totalPages ?? 1} loading={loading} onPage={list.setPage} />
    </section>
  );
}
