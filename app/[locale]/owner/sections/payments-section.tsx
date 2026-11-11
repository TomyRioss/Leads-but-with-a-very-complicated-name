"use client";

import {
  errorBox, rightCell, stateBox, statusPill, tableClass, tableWrap,
  tdClass, theadClass, thClass, trClass, useOwnerFormat, useOwnerList,
} from "../ui";
import { ListToolbar, Pager } from "./list-controls";
import { useTranslations } from "next-intl";

type Payment = {
  id: string;
  paymentId: string;
  status: string;
  amountArs: number;
  credits: number;
  balanceBefore: number;
  userId: string;
  userEmail: string;
  subscriptionId: string;
  created: string;
};

const statusValues = ["processed", "processing", "pending", "rejected", "failed", "refunded", "canceled"];

export default function PaymentsSection({ onUnauthorized }: { onUnauthorized: () => void }) {
  const t = useTranslations("Owner.payments");
  const common = useTranslations("Owner.common");
  const { formatArs, formatDate, formatNumber, statusLabel } = useOwnerFormat();
  const statusOptions = statusValues.map((value) => ({ value, label: statusLabel(value) }));
  const list = useOwnerList<Payment>("/api/owner/payments", t("loadError"), onUnauthorized);
  const { data, loading, error } = list;

  return (
    <section aria-label={t("title")}>
      <ListToolbar title={t("title")} total={data?.totalItems} query={list.query} onQuery={list.setQuery} status={list.status} onStatus={list.setStatus} statusOptions={statusOptions} onRefresh={() => void list.reload()} />
      {error && <p className={errorBox} role="alert">{error}</p>}
      <div className={`${tableWrap}${loading ? " opacity-60 transition-opacity" : ""}`} aria-busy={loading}>
        <table className={tableClass}>
          <thead className={theadClass}>
            <tr>
              <th className={thClass} scope="col">{common("date")}</th>
              <th className={thClass} scope="col">{common("user")}</th>
              <th className={thClass} scope="col">{common("status")}</th>
              <th className={`${thClass} ${rightCell}`} scope="col">{common("amount")}</th>
              <th className={`${thClass} ${rightCell}`} scope="col">{common("credits")}</th>
              <th className={`${thClass} ${rightCell}`} scope="col">{t("balanceBefore")}</th>
              <th className={thClass} scope="col">{t("paymentId")}</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((payment) => (
              <tr className={trClass} key={payment.id}>
                <td className={tdClass} data-label={common("date")}>{formatDate(payment.created)}</td>
                <td className={`${tdClass} break-all`} data-label={common("user")}>{payment.userEmail || "—"}</td>
                <td className={tdClass} data-label={common("status")}><span className={statusPill(payment.status)}>{statusLabel(payment.status)}</span></td>
                <td className={`${tdClass} ${rightCell}`} data-label={common("amount")}>{formatArs(payment.amountArs)}</td>
                <td className={`${tdClass} ${rightCell}`} data-label={common("credits")}>{formatNumber(payment.credits)}</td>
                <td className={`${tdClass} ${rightCell}`} data-label={t("balanceBefore")}>{formatNumber(payment.balanceBefore)}</td>
                <td className={`${tdClass} break-all text-xs`} data-label={t("paymentId")}>{payment.paymentId}</td>
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
