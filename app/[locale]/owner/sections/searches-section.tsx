"use client";

import { useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  confirmBox, dangerButton, errorBox, ghostButton, mutedText, okBox, ownerFetch, rightCell,
  smallButton, stateBox, statusPill, tableClass, tableWrap, tdClass, theadClass, thClass, trClass,
  isUnauthorized, useFocusTrap, useOwnerFormat, useOwnerList, type OnAction,
} from "../ui";
import { ListToolbar, Pager } from "./list-controls";

type Batch = {
  id: string;
  userId: string;
  userEmail: string;
  keywords: string;
  country: string;
  province: string;
  district: string;
  requestedCount: number;
  resultCount: number;
  status: string;
  createdAt: string;
};

const statusValues = ["running", "completed", "partial", "failed"];
const zone = (batch: Batch) => [batch.district, batch.province, batch.country].filter(Boolean).join(", ");

export default function SearchesSection({ onUnauthorized, onAction }: { onUnauthorized: () => void; onAction?: OnAction }) {
  const t = useTranslations("Owner.searches");
  const common = useTranslations("Owner.common");
  const { formatDate, formatNumber, statusLabel, errorText } = useOwnerFormat();
  const statusOptions = statusValues.map((value) => ({ value, label: statusLabel(value) }));
  const list = useOwnerList<Batch>("/api/owner/batches", t("loadError"), onUnauthorized);
  const { data, loading, error, reload } = list;
  const [target, setTarget] = useState<Batch | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const closeTarget = () => {
    setTarget(null);
    window.setTimeout(() => openerRef.current?.focus(), 0);
  };
  useFocusTrap(dialogRef, target !== null, closeTarget);

  async function remove() {
    if (!target || busy) return;
    setBusy(true);
    const result = await ownerFetch<{ ok?: boolean; deletedLeads?: number }>(`/api/owner/batches/${encodeURIComponent(target.id)}`, { method: "DELETE" });
    setBusy(false);
    closeTarget();
    if (isUnauthorized(result.status)) return onUnauthorized();
    if (result.ok) {
      const text = t("deleted", { count: result.data.deletedLeads ?? 0 });
      setNotice({ kind: "ok", text });
      onAction?.(text);
      void reload();
    } else {
      setNotice({ kind: "error", text: errorText(result.data.error, t("deleteError")) });
      void reload();
    }
  }

  return (
    <section aria-label={t("title")}>
      <ListToolbar title={t("title")} total={data?.totalItems} query={list.query} onQuery={list.setQuery} status={list.status} onStatus={list.setStatus} statusOptions={statusOptions} onRefresh={() => void reload()} />
      {error && <p className={errorBox} role="alert">{error}</p>}
      {notice && <p className={notice.kind === "ok" ? okBox : errorBox} role={notice.kind === "ok" ? "status" : "alert"}>{notice.text}</p>}
      {target && (
        <div ref={dialogRef} className={`${confirmBox} mb-3.5`} role="alertdialog" aria-label={t("confirmLabel")}>
          <p className="m-0 text-[13px] font-semibold">
            {t("confirmDelete", { keywords: target.keywords || t("noIndustry"), user: target.userEmail || t("aUser"), count: formatNumber(target.resultCount) })}
          </p>
          <div className="flex flex-wrap gap-2">
            <button className={dangerButton} type="button" disabled={busy} onClick={() => void remove()}>{busy ? common("deleting") : t("deletePermanently")}</button>
            <button className={ghostButton} type="button" disabled={busy} onClick={closeTarget} autoFocus>{common("back")}</button>
          </div>
        </div>
      )}
      <div className={`${tableWrap}${loading ? " opacity-60 transition-opacity" : ""}`} aria-busy={loading}>
        <table className={tableClass}>
          <thead className={theadClass}>
            <tr>
              <th className={thClass} scope="col">{common("date")}</th>
              <th className={thClass} scope="col">{common("user")}</th>
              <th className={thClass} scope="col">{t("industry")}</th>
              <th className={thClass} scope="col">{t("area")}</th>
              <th className={`${thClass} ${rightCell}`} scope="col">{t("requestedResults")}</th>
              <th className={thClass} scope="col">{common("status")}</th>
              <th className={thClass} scope="col"><span className="sr-only">{common("actions")}</span></th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((batch) => (
              <tr className={trClass} key={batch.id}>
                <td className={tdClass} data-label={common("date")}>{formatDate(batch.createdAt)}</td>
                <td className={`${tdClass} break-all`} data-label={common("user")}>{batch.userEmail || <span className={mutedText}>{common("noUser")}</span>}</td>
                <td className={tdClass} data-label={t("industry")}>{batch.keywords || "—"}</td>
                <td className={tdClass} data-label={t("area")}>{zone(batch) || "—"}</td>
                <td className={`${tdClass} ${rightCell}`} data-label={t("requestedResults")}>{formatNumber(batch.requestedCount)} / {formatNumber(batch.resultCount)}</td>
                <td className={tdClass} data-label={common("status")}><span className={statusPill(batch.status)}>{statusLabel(batch.status)}</span></td>
                <td className={`${tdClass} max-md:justify-end`}>
                  <button className={`${dangerButton} ${smallButton}`} type="button" disabled={busy} onClick={(event) => { openerRef.current = event.currentTarget; setNotice(null); setTarget(batch); }} aria-label={t("deleteAria", { name: batch.keywords || batch.id })}>
                    <Trash2 size={14} aria-hidden="true" /> {t("delete")} </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data && loading && <p className={stateBox} role="status">{t("loading")}</p>}
        {data && data.items.length === 0 && !loading && <p className={stateBox}>{list.query || list.status ? common("noResultsFilter") : t("empty")}</p>}
      </div>
      <Pager page={list.page} totalPages={data?.totalPages ?? 1} loading={loading} onPage={list.setPage} />
    </section>
  );
}
