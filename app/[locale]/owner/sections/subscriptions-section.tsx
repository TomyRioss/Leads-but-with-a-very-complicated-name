"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("UI");
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
              <p className="m-0 text-[13px] font-semibold">{t("t_8cb14146b1")} {pending.row.userEmail || "este usuario"} {t("t_01cbd11760")} {planName(pending.row.planId)}).</p>
              <label className="grid gap-1.5 text-xs">
                {t("t_782a46bcd4")} <select className={controlClass} value={newPlan} onChange={(event) => setNewPlan(event.target.value)}>
                  {manualPlans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {formatArs(plan.priceArs)} · {formatNumber(plan.credits)} {t("t_bcc0da40b3")}</option>)}
                </select>
              </label>
            </>
          )}
          <div className="flex flex-wrap gap-2">
            <button className={primaryButton} type="button" disabled={busy} onClick={() => void confirm()}>{busy ? "Guardando…" : "Confirmar"}</button>
            <button className={ghostButton} type="button" disabled={busy} onClick={closePending} autoFocus>{t("t_84a715a785")}</button>
          </div>
        </div>
      )}
      <div className={`${tableWrap}${loading ? " opacity-60 transition-opacity" : ""}`} aria-busy={loading}>
        <table className={tableClass}>
          <thead className={theadClass}>
            <tr>
              <th className={thClass} scope="col">{t("t_ef9168c3d7")}</th>
              <th className={thClass} scope="col">{t("t_3f2ecdef3c")}</th>
              <th className={thClass} scope="col">{t("t_ae2f98a099")}</th>
              <th className={thClass} scope="col">{t("t_87cf2a843e")}</th>
              <th className={`${thClass} ${rightCell}`} scope="col">{t("t_18e0707ea7")}</th>
              <th className={`${thClass} ${rightCell}`} scope="col">{t("t_cb722e8b79")}</th>
              <th className={thClass} scope="col">{t("t_79bd0ed912")}</th>
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
                    {row.status === "authorized" && <button className={`${ghostButton} ${smallButton}`} type="button" disabled={busy} onClick={(event) => askStatus(event.currentTarget, row, "paused", "Pausar", "Suscripción pausada.")}>{t("t_8e0f5ed990")}</button>}
                    {row.status === "paused" && <button className={`${ghostButton} ${smallButton}`} type="button" disabled={busy} onClick={(event) => askStatus(event.currentTarget, row, "authorized", "Reactivar", "Suscripción reactivada.")}>{t("t_cb081a42fc")}</button>}
                    {live.includes(row.status) && <button className={`${dangerButton} ${smallButton}`} type="button" disabled={busy} onClick={(event) => askStatus(event.currentTarget, row, "cancelled", "Cancelar", "Suscripción cancelada.")}>{t("t_c111e0ab9d")}</button>}
                    {live.includes(row.status) && <button className={`${ghostButton} ${smallButton}`} type="button" disabled={busy} onClick={(event) => { openerRef.current = event.currentTarget; setNotice(null); setNewPlan(manualPlans.some((plan) => plan.id === row.planId) ? row.planId : (manualPlans[0]?.id ?? "initial")); setPending({ kind: "plan", row }); }}>{t("t_200a52e551")}</button>}
                    {!live.includes(row.status) && <span className={mutedText}>{t("t_62606d0cd1")}</span>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data && loading && <p className={stateBox} role="status">{t("t_006e001be4")}</p>}
        {data && data.items.length === 0 && !loading && <p className={stateBox}>{list.query || list.status ? "Sin resultados para ese filtro." : "Todavía no hay suscripciones."}</p>}
      </div>
      <Pager page={list.page} totalPages={data?.totalPages ?? 1} loading={loading} onPage={list.setPage} />
    </section>
  );
}
