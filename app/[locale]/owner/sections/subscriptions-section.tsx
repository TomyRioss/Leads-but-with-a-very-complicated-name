"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  confirmBox, dangerButton, errorBox, ghostButton, isUnauthorized, mutedText, type OnAction,
  okBox, ownerFetch, primaryButton, rightCell, smallButton, stateBox, statusPill, tableClass, tableWrap, tdClass,
  theadClass, thClass, trClass, useFocusTrap, useOwnerFormat, useOwnerList,
} from "../ui";
import { ListToolbar, Pager } from "./list-controls";

type Subscription = {
  id: string;
  userId: string;
  userEmail: string;
  planId: string;
  status: string;
  priceArs: number;
  monthlyCredits: number;
  externalReference: string;
  created: string;
};
type Pending = { kind: "status"; row: Subscription; status: "authorized" | "paused" | "cancelled"; message: string; success: string };

const live = ["authorized", "paused", "pending"];
const statusValues = ["authorized", "paused", "pending", "canceled", "rejected", "creating"];

export default function SubscriptionsSection({ onUnauthorized, onAction }: { onUnauthorized: () => void; onAction?: OnAction }) {
  const t = useTranslations("Owner.subscriptions");
  const common = useTranslations("Owner.common");
  const { formatArs, formatDate, formatNumber, planName, statusLabel, errorText } = useOwnerFormat();
  const statusOptions = statusValues.map((value) => ({ value, label: statusLabel(value) }));
  const list = useOwnerList<Subscription>("/api/owner/subscriptions", t("loadError"), onUnauthorized);
  const { data, loading, error, reload } = list;
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const closePending = () => {
    setPending(null);
    window.setTimeout(() => openerRef.current?.focus(), 0);
  };
  useFocusTrap(dialogRef, pending !== null, closePending);

  const askStatus = (opener: HTMLElement, row: Subscription, status: "authorized" | "paused" | "cancelled") => {
    openerRef.current = opener;
    setNotice(null);
    const kind = status === "paused" ? "Pause" : status === "authorized" ? "Resume" : "Cancel";
    const values = { plan: planName(row.planId), email: row.userEmail || t("thisUser") };
    setPending({
      kind: "status", row, status,
      success: t(status === "paused" ? "paused" : status === "authorized" ? "resumed" : "cancelled"),
      message: t(`confirm${kind}`, values),
    });
  };

  async function confirm() {
    if (!pending || busy) return;
    setBusy(true);
    const { row } = pending;
    const body = { status: pending.status };
    const success = pending.success;
    const result = await ownerFetch(`/api/owner/subscriptions/${encodeURIComponent(row.id)}`, { method: "PATCH", body });
    setBusy(false);
    closePending();
    if (isUnauthorized(result.status)) return onUnauthorized();
    if (result.ok) {
      setNotice({ kind: "ok", text: success });
      onAction?.(success);
      void reload();
    } else {
      setNotice({ kind: "error", text: errorText(result.data.error, common("actionError")) });
    }
  }

  return (
    <section aria-label={t("title")}>
      <ListToolbar title={t("title")} total={data?.totalItems} query={list.query} onQuery={list.setQuery} status={list.status} onStatus={list.setStatus} statusOptions={statusOptions} onRefresh={() => void reload()} />
      <p className={mutedText}>{t("managedExternally")}</p>
      {error && <p className={errorBox} role="alert">{error}</p>}
      {notice && <p className={notice.kind === "ok" ? okBox : errorBox} role={notice.kind === "ok" ? "status" : "alert"}>{notice.text}</p>}
      {pending && (
        <div ref={dialogRef} className={`${confirmBox} mb-3.5`} role="alertdialog" aria-label={common("confirmAction")}>
          <p className="m-0 text-[13px] font-semibold">{pending.message}</p>
          <div className="flex flex-wrap gap-2">
            <button className={primaryButton} type="button" disabled={busy} onClick={() => void confirm()}>{busy ? common("saving") : common("confirm")}</button>
            <button className={ghostButton} type="button" disabled={busy} onClick={closePending} autoFocus>{common("back")}</button>
          </div>
        </div>
      )}
      <div className={`${tableWrap}${loading ? " opacity-60 transition-opacity" : ""}`} aria-busy={loading}>
        <table className={tableClass}>
          <thead className={theadClass}>
            <tr>
              <th className={thClass} scope="col">{common("created")}</th>
              <th className={thClass} scope="col">{common("user")}</th>
              <th className={thClass} scope="col">{common("plan")}</th>
              <th className={thClass} scope="col">{common("status")}</th>
              <th className={`${thClass} ${rightCell}`} scope="col">{t("price")}</th>
              <th className={`${thClass} ${rightCell}`} scope="col">{t("monthlyCredits")}</th>
              <th className={thClass} scope="col">{common("actions")}</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((row) => (
              <tr className={trClass} key={row.id}>
                <td className={tdClass} data-label={common("created")}>{formatDate(row.created)}</td>
                <td className={`${tdClass} break-all`} data-label={common("user")}>{row.userEmail || "—"}</td>
                <td className={tdClass} data-label={common("plan")}>{planName(row.planId)}</td>
                <td className={tdClass} data-label={common("status")}><span className={statusPill(row.status)}>{statusLabel(row.status)}</span></td>
                <td className={`${tdClass} ${rightCell}`} data-label={t("price")}>{formatArs(row.priceArs)}</td>
                <td className={`${tdClass} ${rightCell}`} data-label={t("monthlyCredits")}>{formatNumber(row.monthlyCredits)}</td>
                <td className={tdClass} data-label={common("actions")}>
                  <div className="flex flex-wrap gap-1.5 max-md:justify-end">
                    {row.status === "authorized" && <button className={`${ghostButton} ${smallButton}`} type="button" disabled={busy} onClick={(event) => askStatus(event.currentTarget, row, "paused")}>{t("pause")}</button>}
                    {row.status === "paused" && <button className={`${ghostButton} ${smallButton}`} type="button" disabled={busy} onClick={(event) => askStatus(event.currentTarget, row, "authorized")}>{t("resume")}</button>}
                    {live.includes(row.status) && <button className={`${dangerButton} ${smallButton}`} type="button" disabled={busy} onClick={(event) => askStatus(event.currentTarget, row, "cancelled")}>{t("cancel")}</button>}
                    {!live.includes(row.status) && <span className={mutedText}>{common("noActions")}</span>}
                  </div>
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
