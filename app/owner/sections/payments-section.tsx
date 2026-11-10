"use client";

import {
  errorBox, formatArs, formatDate, formatNumber, rightCell, stateBox, statusLabel, statusPill, tableClass, tableWrap,
  tdClass, theadClass, thClass, trClass, useOwnerList,
} from "../ui";
import { ListToolbar, Pager } from "./list-controls";

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

const statusOptions = ["processed", "processing", "pending", "rejected", "failed", "refunded", "canceled"].map((value) => ({ value, label: statusLabel(value) }));

export default function PaymentsSection({ onUnauthorized }: { onUnauthorized: () => void }) {
  const list = useOwnerList<Payment>("/api/owner/payments", "No se pudieron cargar los pagos.", onUnauthorized);
  const { data, loading, error } = list;

  return (
    <section aria-label="Pagos">
      <ListToolbar title="Pagos" total={data?.totalItems} query={list.query} onQuery={list.setQuery} status={list.status} onStatus={list.setStatus} statusOptions={statusOptions} onRefresh={() => void list.reload()} />
      {error && <p className={errorBox} role="alert">{error}</p>}
      <div className={`${tableWrap}${loading ? " opacity-60 transition-opacity" : ""}`} aria-busy={loading}>
        <table className={tableClass}>
          <thead className={theadClass}>
            <tr>
              <th className={thClass} scope="col">Fecha</th>
              <th className={thClass} scope="col">Usuario</th>
              <th className={thClass} scope="col">Estado</th>
              <th className={`${thClass} ${rightCell}`} scope="col">Monto</th>
              <th className={`${thClass} ${rightCell}`} scope="col">Créditos</th>
              <th className={`${thClass} ${rightCell}`} scope="col">Saldo previo</th>
              <th className={thClass} scope="col">ID de pago</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((payment) => (
              <tr className={trClass} key={payment.id}>
                <td className={tdClass} data-label="Fecha">{formatDate(payment.created)}</td>
                <td className={`${tdClass} break-all`} data-label="Usuario">{payment.userEmail || "—"}</td>
                <td className={tdClass} data-label="Estado"><span className={statusPill(payment.status)}>{statusLabel(payment.status)}</span></td>
                <td className={`${tdClass} ${rightCell}`} data-label="Monto">{formatArs(payment.amountArs)}</td>
                <td className={`${tdClass} ${rightCell}`} data-label="Créditos">{formatNumber(payment.credits)}</td>
                <td className={`${tdClass} ${rightCell}`} data-label="Saldo previo">{formatNumber(payment.balanceBefore)}</td>
                <td className={`${tdClass} break-all text-xs`} data-label="ID de pago">{payment.paymentId}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data && loading && <p className={stateBox} role="status">Cargando pagos…</p>}
        {data && data.items.length === 0 && !loading && <p className={stateBox}>{list.query || list.status ? "Sin resultados para ese filtro." : "Todavía no hay pagos."}</p>}
      </div>
      <Pager page={list.page} totalPages={data?.totalPages ?? 1} loading={loading} onPage={list.setPage} />
    </section>
  );
}
