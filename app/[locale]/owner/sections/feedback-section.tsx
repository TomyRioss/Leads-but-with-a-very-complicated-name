"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Bug, ExternalLink, MessageSquare } from "lucide-react";
import {
  errorBox, ghostButton, isUnauthorized, ownerFetch, primaryButton, smallButton, stateBox, statusPill, tableClass, tableWrap,
  tdClass, theadClass, thClass, trClass, useOwnerFormat, useOwnerList, type OnAction,
} from "../ui";
import { ListToolbar, Pager } from "./list-controls";

type FeedbackItem = {
  id: string;
  identifier: string;
  url: string;
  createdAt: string;
  state: "open" | "closed";
  kind: "comment" | "bug";
  message: string;
  user: { id: string; email: string } | null;
};

const rewardCredits = 50;

export default function FeedbackSection({ onUnauthorized, onAction }: { onUnauthorized: () => void; onAction: OnAction }) {
  const t = useTranslations("Owner.feedback");
  const common = useTranslations("Owner.common");
  const { formatDateTime, errorText } = useOwnerFormat();
  const list = useOwnerList<FeedbackItem>("/api/owner/feedback", t("loadError"), onUnauthorized);
  const { data, loading, error } = list;
  const [confirmId, setConfirmId] = useState("");
  const [busyId, setBusyId] = useState("");
  const [actionError, setActionError] = useState("");
  const statusOptions = [{ value: "open", label: t("open") }, { value: "closed", label: t("closed") }];

  async function closeFeedback(item: FeedbackItem) {
    setBusyId(item.id);
    setActionError("");
    const result = await ownerFetch<{ emailSent?: boolean }>(`/api/owner/feedback/${encodeURIComponent(item.id)}`, { method: "POST" });
    setBusyId("");
    setConfirmId("");
    if (isUnauthorized(result.status)) return onUnauthorized();
    if (!result.ok) {
      setActionError(errorText(result.data.error, t("closeError")));
      return;
    }
    onAction(result.data.emailSent === false ? t("closed_noEmail") : t("closed_ok", { credits: rewardCredits, email: item.user?.email ?? "" }));
    void list.reload();
  }

  return (
    <section aria-label={t("title")}>
      <ListToolbar
        title={t("title")}
        total={data?.totalItems}
        query={list.query}
        onQuery={list.setQuery}
        queryLabel={t("searchLabel")}
        status={list.status}
        onStatus={list.setStatus}
        statusLabel={t("statusLabel")}
        allLabel={t("all")}
        statusOptions={statusOptions}
        onRefresh={() => void list.reload()}
      />
      {(error || actionError) && <p className={errorBox} role="alert">{actionError || error}</p>}
      <div className={`${tableWrap}${loading ? " opacity-60 transition-opacity" : ""}`} aria-busy={loading}>
        <table className={tableClass}>
          <thead className={theadClass}>
            <tr>
              <th className={thClass} scope="col">{common("date")}</th>
              <th className={thClass} scope="col">{common("user")}</th>
              <th className={thClass} scope="col">{t("type")}</th>
              <th className={thClass} scope="col">{t("message")}</th>
              <th className={thClass} scope="col">{common("status")}</th>
              <th className={thClass} scope="col">{t("linear")}</th>
              <th className={thClass} scope="col">{t("actions")}</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((item) => (
              <tr className={trClass} key={item.id}>
                <td className={`${tdClass} whitespace-nowrap`} data-label={common("date")}>{formatDateTime(item.createdAt)}</td>
                <td className={`${tdClass} break-all`} data-label={common("user")}>{item.user?.email ?? "—"}</td>
                <td className={tdClass} data-label={t("type")}>
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    {item.kind === "bug" ? <Bug size={14} aria-hidden="true" /> : <MessageSquare size={14} aria-hidden="true" />}
                    {item.kind === "bug" ? t("kindBug") : t("kindComment")}
                  </span>
                </td>
                <td className={`${tdClass} min-w-[240px] max-w-[460px] whitespace-pre-line break-words`} data-label={t("message")}>{item.message || "—"}</td>
                <td className={tdClass} data-label={common("status")}>
                  <span className={statusPill(item.state === "closed" ? "completed" : "pending")}>{item.state === "closed" ? t("closed") : t("open")}</span>
                </td>
                <td className={tdClass} data-label={t("linear")}>
                  <a className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-semibold underline underline-offset-[3px]" href={item.url} target="_blank" rel="noopener noreferrer">
                    {item.identifier}<ExternalLink size={12} aria-hidden="true" />
                  </a>
                </td>
                <td className={tdClass} data-label={t("actions")}>
                  {item.state === "open" && item.user ? (
                    confirmId === item.id ? (
                      <span className="inline-flex flex-wrap gap-1.5">
                        <button className={`${primaryButton} ${smallButton}`} type="button" disabled={busyId === item.id} onClick={() => void closeFeedback(item)}>
                          {busyId === item.id ? t("closing") : t("confirm", { credits: rewardCredits })}
                        </button>
                        <button className={`${ghostButton} ${smallButton}`} type="button" disabled={busyId === item.id} onClick={() => setConfirmId("")}>{common("cancel")}</button>
                      </span>
                    ) : (
                      <button className={`${ghostButton} ${smallButton} whitespace-nowrap`} type="button" disabled={Boolean(busyId)} onClick={() => setConfirmId(item.id)}>{t("close")}</button>
                    )
                  ) : "—"}
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
