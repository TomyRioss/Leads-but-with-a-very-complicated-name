"use client";

import {
  actionLabel, actionLabels, describeDetails, errorBox, formatDateTime, stateBox, tableClass, tableWrap, tdClass, theadClass,
  thClass, trClass, useOwnerList,
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

const actionOptions = Object.entries(actionLabels).map(([value, label]) => ({ value, label }));

export default function AuditSection({ onUnauthorized }: { onUnauthorized: () => void }) {
  const t = useTranslations("UI");
  const list = useOwnerList<AuditItem>("/api/owner/audit", "No se pudo cargar la auditoría.", onUnauthorized, "action");
  const { data, loading, error } = list;

  return (
    <section aria-label="Auditoría">
      <ListToolbar title="Auditoría" total={data?.totalItems} query={list.query} onQuery={list.setQuery} queryLabel="Buscar por usuario u objetivo" status={list.status} onStatus={list.setStatus} statusLabel="Filtrar por acción" allLabel="Todas las acciones" statusOptions={actionOptions} onRefresh={() => void list.reload()} />
      {error && <p className={errorBox} role="alert">{error}</p>}
      <div className={`${tableWrap}${loading ? " opacity-60 transition-opacity" : ""}`} aria-busy={loading}>
        <table className={tableClass}>
          <thead className={theadClass}>
            <tr>
              <th className={thClass} scope="col">{t("t_ab880f2011")}</th>
              <th className={thClass} scope="col">{t("t_59e1f9e471")}</th>
              <th className={thClass} scope="col">{t("t_d7927a6398")}</th>
              <th className={thClass} scope="col">{t("t_fb097b23d2")}</th>
              <th className={thClass} scope="col">{t("t_be605b5aa2")}</th>
              <th className={thClass} scope="col">{t("t_ea424d38af")}</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((entry) => {
              const rows = describeDetails(entry.details);
              return (
                <tr className={`${trClass} align-top`} key={entry.id}>
                  <td className={`${tdClass} whitespace-nowrap`} data-label="Fecha y hora">{formatDateTime(entry.created)}</td>
                  <td className={`${tdClass} break-all`} data-label="Quién">{entry.actorEmail || "—"}</td>
                  <td className={`${tdClass} font-semibold`} data-label="Acción">{actionLabel(entry.action)}</td>
                  <td className={`${tdClass} break-all`} data-label="Objetivo">{entry.targetLabel || "—"}</td>
                  <td className={`${tdClass} max-md:block max-md:text-left`} data-label="Detalle">
                    {rows.length === 0 ? <span className="text-xs text-(color:--muted)">{t("t_5f3628dfff")}</span> : (
                      <details className="group text-xs">
                        <summary className="cursor-pointer select-none font-semibold underline underline-offset-[3px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(color:--ash-950)">{t("t_3c5d7a3aa8")}</summary>
                        <dl className="m-0 mt-2 grid gap-1">
                          {rows.map(([label, value]) => (
                            <div className="grid grid-cols-[minmax(0,9rem)_1fr] gap-2" key={label}><dt className="text-(color:--muted)">{label}</dt><dd className="m-0 break-words">{value}</dd></div>
                          ))}
                        </dl>
                      </details>
                    )}
                  </td>
                  <td className={`${tdClass} text-xs`} data-label="IP">{entry.ip || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!data && loading && <p className={stateBox} role="status">{t("t_b77f5a4f30")}</p>}
        {data && data.items.length === 0 && !loading && <p className={stateBox}>{list.query || list.status ? "Sin resultados para ese filtro." : "Todavía no hay acciones registradas."}</p>}
      </div>
      <Pager page={list.page} totalPages={data?.totalPages ?? 1} loading={loading} onPage={list.setPage} />
    </section>
  );
}
