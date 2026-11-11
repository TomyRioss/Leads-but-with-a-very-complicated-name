"use client";

import { useRef, useState } from "react";
import { subscriptionPlans } from "@/lib/plans";
import {
  confirmBox, controlClass, dangerButton, errorBox, formatArs, formatDate, formatNumber, ghostButton, isUnauthorized, mutedText, type OnAction,
  okBox, ownerFetch, planName, primaryButton, rightCell, smallButton, stateBox, statusLabel, statusPill, tableClass, tableWrap, tdClass,
  theadClass, thClass, trClass, useFocusTrap, useOwnerList,
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
type Pending =
  | { kind: "status"; row: Subscription; status: "authorized" | "paused" | "cancelled"; message: string; success: string }
  | { kind: "plan"; row: Subscription };

const manualPlans = subscriptionPlans.filter((plan) => ["initial", "pro", "agency"].includes(plan.id));
const live = ["authorized", "paused", "pending"];
const statusOptions = ["authorized", "paused", "pending", "canceled", "rejected", "creating"].map((value) => ({ value, label: statusLabel(value) }));

export default function SubscriptionsSection({ onUnauthorized, onAction }: { onUnauthorized: () => void; onAction?: OnAction }) {
  const list = useOwnerList<Subscription>("/api/owner/subscriptions", "No se pudieron cargar las suscripciones.", onUnauthorized);
  const { data, loading, error, reload } = list;
  const [pending, setPending] = useState<Pending | null>(null);
  const [newPlan, setNewPlan] = useState<string>(manualPlans[0]?.id ?? "initial");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const closePending = () => {
    setPending(null);
    window.setTimeout(() => openerRef.current?.focus(), 0);
  };
  useFocusTrap(dialogRef, pending !== null, closePending);

  const askStatus = (opener: HTMLElement, row: Subscription, status: "authorized" | "paused" | "cancelled", verb: string, success: string) => {
    openerRef.current = opener;
    setNotice(null);
    setPending({ kind: "status", row, status, success, message: `${verb} la suscripción ${planName(row.planId)} de ${row.userEmail || "este usuario"}?${status === "cancelled" ? " Esta acción no se puede deshacer." : ""}` });
  };

  async function confirm() {
    if (!pending || busy) return;
    setBusy(true);
    const { row } = pending;
    const body = pending.kind === "status" ? { status: pending.status } : { planId: newPlan };
    const success = pending.kind === "status" ? pending.success : `Plan cambiado a ${planName(newPlan)}.`;
    const result = await ownerFetch(`/api/owner/subscriptions/${encodeURIComponent(row.id)}`, { method: "PATCH", body });
    setBusy(false);
    closePending();
    if (isUnauthorized(result.status)) return onUnauthorized();
    if (result.ok) {
      setNotice({ kind: "ok", text: success });
      onAction?.(success);
      void reload();
    } else {
      setNotice({ kind: "error", text: result.data.error || "No se pudo completar la acción." });
    }
  }

  return (
    <section aria-label="Suscripciones">
      <ListToolbar title="Suscripciones" total={data?.totalItems} query={list.query} onQuery={list.setQuery} status={list.status} onStatus={list.setStatus} statusOptions={statusOptions} onRefresh={() => void reload()} />
      {error && <p className={errorBox} role="alert">{error}</p>}
      {notice && <p className={notice.kind === "ok" ? okBox : errorBox} role={notice.kind === "ok" ? "status" : "alert"}>{notice.text}</p>}
      {pending && (
        <div ref={dialogRef} className={`${confirmBox} mb-3.5`} role="alertdialog" aria-label="Confirmar acción">
          {pending.kind === "status" ? (
            <p className="m-0 text-[13px] font-semibold">{pending.message}</p>
          ) : (
            <>
              <p className="m-0 text-[13px] font-semibold">Cambiar el plan de {pending.row.userEmail || "este usuario"} (hoy {planName(pending.row.planId)}).</p>
              <label className="grid gap-1.5 text-xs">
                Nuevo plan
                <select className={controlClass} value={newPlan} onChange={(event) => setNewPlan(event.target.value)}>
                  {manualPlans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {formatArs(plan.priceArs)} · {formatNumber(plan.credits)} créditos</option>)}
                </select>
              </label>
            </>
          )}
          <div className="flex flex-wrap gap-2">
            <button className={primaryButton} type="button" disabled={busy} onClick={() => void confirm()}>{busy ? "Guardando…" : "Confirmar"}</button>
            <button className={ghostButton} type="button" disabled={busy} onClick={closePending} autoFocus>Volver</button>
          </div>
        </div>
      )}
      <div className={`${tableWrap}${loading ? " opacity-60 transition-opacity" : ""}`} aria-busy={loading}>
        <table className={tableClass}>
          <thead className={theadClass}>
            <tr>
              <th className={thClass} scope="col">Alta</th>
              <th className={thClass} scope="col">Usuario</th>
              <th className={thClass} scope="col">Plan</th>
              <th className={thClass} scope="col">Estado</th>
              <th className={`${thClass} ${rightCell}`} scope="col">Precio</th>
              <th className={`${thClass} ${rightCell}`} scope="col">Créditos/mes</th>
              <th className={thClass} scope="col">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((row) => (
              <tr className={trClass} key={row.id}>
                <td className={tdClass} data-label="Alta">{formatDate(row.created)}</td>
                <td className={`${tdClass} break-all`} data-label="Usuario">{row.userEmail || "—"}</td>
                <td className={tdClass} data-label="Plan">{planName(row.planId)}</td>
                <td className={tdClass} data-label="Estado"><span className={statusPill(row.status)}>{statusLabel(row.status)}</span></td>
                <td className={`${tdClass} ${rightCell}`} data-label="Precio">{formatArs(row.priceArs)}</td>
                <td className={`${tdClass} ${rightCell}`} data-label="Créditos/mes">{formatNumber(row.monthlyCredits)}</td>
                <td className={tdClass} data-label="Acciones">
                  <div className="flex flex-wrap gap-1.5 max-md:justify-end">
                    {row.status === "authorized" && <button className={`${ghostButton} ${smallButton}`} type="button" disabled={busy} onClick={(event) => askStatus(event.currentTarget, row, "paused", "Pausar", "Suscripción pausada.")}>Pausar</button>}
                    {row.status === "paused" && <button className={`${ghostButton} ${smallButton}`} type="button" disabled={busy} onClick={(event) => askStatus(event.currentTarget, row, "authorized", "Reactivar", "Suscripción reactivada.")}>Reactivar</button>}
                    {live.includes(row.status) && <button className={`${dangerButton} ${smallButton}`} type="button" disabled={busy} onClick={(event) => askStatus(event.currentTarget, row, "cancelled", "Cancelar", "Suscripción cancelada.")}>Cancelar</button>}
                    {live.includes(row.status) && <button className={`${ghostButton} ${smallButton}`} type="button" disabled={busy} onClick={(event) => { openerRef.current = event.currentTarget; setNotice(null); setNewPlan(manualPlans.some((plan) => plan.id === row.planId) ? row.planId : (manualPlans[0]?.id ?? "initial")); setPending({ kind: "plan", row }); }}>Cambiar plan</button>}
                    {!live.includes(row.status) && <span className={mutedText}>Sin acciones</span>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data && loading && <p className={stateBox} role="status">Cargando suscripciones…</p>}
        {data && data.items.length === 0 && !loading && <p className={stateBox}>{list.query || list.status ? "Sin resultados para ese filtro." : "Todavía no hay suscripciones."}</p>}
      </div>
      <Pager page={list.page} totalPages={data?.totalPages ?? 1} loading={loading} onPage={list.setPage} />
    </section>
  );
}
