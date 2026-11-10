"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Search, Trash2, X } from "lucide-react";
import { subscriptionPlans } from "@/lib/plans";
import {
  blockClass, confirmBox, controlClass, countBadge, dangerButton, errorBox, formatArs, formatDate, formatNumber, ghostButton,
  hintText, iconButton, isUnauthorized, mutedText, okBox, ownerFetch, planName, primaryButton, rightCell, sectionHead,
  sectionTitle, stateBox, statusLabel, statusPill, tableClass, tableWrap, tdClass, theadClass, thClass, trClass, useFocusTrap,
  useOwnerList, type OnAction, type OwnerResult,
} from "../ui";
import { Pager } from "./list-controls";

type SubscriptionSummary = { id: string; planId: string; status: string; priceArs: number; monthlyCredits: number };
type UserRow = { id: string; email: string; name: string; credits: number; created: string; subscription: SubscriptionSummary | null };
type UserDetail = {
  user: { id: string; email: string; name: string; credits: number; created: string };
  subscriptions: (SubscriptionSummary & { externalReference?: string; manual: boolean; created: string })[];
  subscriptionsHasMore?: boolean;
  paymentsHasMore?: boolean;
  payments: { id: string; paymentId: string; status: string; amountArs: number; credits: number; created: string }[];
};
type Pending = { message: string; run: () => Promise<OwnerResult<unknown>>; success: string };

const manualPlans = subscriptionPlans.filter((plan) => ["initial", "pro", "agency"].includes(plan.id));
const live = ["authorized", "paused", "pending"];

export default function UsersSection({ onUnauthorized, onAction }: { onUnauthorized: () => void; onAction?: OnAction }) {
  const list = useOwnerList<UserRow>("/api/owner/users", "No se pudieron cargar los usuarios.", onUnauthorized);
  const { data, loading, error, reload } = list;
  const [selected, setSelected] = useState("");
  const openerRef = useRef<HTMLElement | null>(null);
  const closeDrawer = useCallback(() => {
    setSelected("");
    window.setTimeout(() => openerRef.current?.focus(), 0);
  }, []);

  return (
    <section aria-label="Usuarios">
      <div className={sectionHead}>
        <h1 className={sectionTitle}>Usuarios{data ? <span className={countBadge}>{formatNumber(data.totalItems)}</span> : null}</h1>
        <label className="relative flex w-full items-center sm:w-auto">
          <Search className="pointer-events-none absolute left-3 text-(color:--ash-600)" size={15} aria-hidden="true" />
          <span className="sr-only">Buscar por email o nombre</span>
          <input className={`${controlClass} pl-[33px] sm:w-65`} type="search" placeholder="Buscar email o nombre" value={list.query} onChange={(event) => list.setQuery(event.target.value)} />
        </label>
      </div>
      {error && <p className={errorBox} role="alert">{error}</p>}
      <div className={`${tableWrap}${loading ? " opacity-60 transition-opacity" : ""}`} aria-busy={loading}>
        <table className={tableClass}>
          <thead className={theadClass}>
            <tr>
              <th className={thClass} scope="col">Email</th>
              <th className={thClass} scope="col">Nombre</th>
              <th className={`${thClass} ${rightCell}`} scope="col">Créditos</th>
              <th className={thClass} scope="col">Plan</th>
              <th className={thClass} scope="col">Alta</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((user) => (
              <tr className={trClass} key={user.id}>
                <td className={tdClass} data-label="Email">
                  <button type="button" className="cursor-pointer break-all rounded border-0 bg-transparent py-1.5 text-left text-xs font-semibold text-(color:--ink) underline decoration-(--ash-300) underline-offset-[3px] hover:decoration-(--ink) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(color:--ash-950)" onClick={(event) => { openerRef.current = event.currentTarget; setSelected(user.id); }}>{user.email}</button>
                </td>
                <td className={tdClass} data-label="Nombre">{user.name || "—"}</td>
                <td className={`${tdClass} ${rightCell}`} data-label="Créditos">{formatNumber(user.credits)}</td>
                <td className={tdClass} data-label="Plan">{user.subscription ? <span>{planName(user.subscription.planId)} <span className={`${statusPill(user.subscription.status)} ml-1`}>{statusLabel(user.subscription.status)}</span></span> : <span className={mutedText}>Sin plan</span>}</td>
                <td className={tdClass} data-label="Alta">{formatDate(user.created)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.items.length === 0 && !loading && <p className={stateBox}>{list.query ? "Sin resultados para esa búsqueda." : "Todavía no hay usuarios."}</p>}
        {!data && loading && <p className={stateBox} role="status">Cargando usuarios…</p>}
      </div>
      <Pager page={list.page} totalPages={data?.totalPages ?? 1} loading={loading} onPage={list.setPage} />

      {selected && <UserDrawer userId={selected} onClose={closeDrawer} onChanged={() => void reload()} onUnauthorized={onUnauthorized} onAction={onAction} />}
    </section>
  );
}

function UserDrawer({ userId, onClose, onChanged, onUnauthorized, onAction }: {
  userId: string;
  onClose: () => void;
  onChanged: () => void;
  onUnauthorized: () => void;
  onAction?: OnAction;
}) {
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [loadError, setLoadError] = useState("");
  const [mode, setMode] = useState<"set" | "add">("set");
  const [amount, setAmount] = useState("");
  const [name, setName] = useState<string | null>(null);
  const [planId, setPlanId] = useState<string>(manualPlans[0]?.id ?? "initial");
  const [grant, setGrant] = useState(true);
  const [deleteEmail, setDeleteEmail] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);

  const load = useCallback(async () => {
    const result = await ownerFetch<UserDetail>(`/api/owner/users/${encodeURIComponent(userId)}`);
    if (isUnauthorized(result.status)) return onUnauthorized();
    if (result.ok) { setDetail(result.data); setLoadError(""); }
    else setLoadError(result.data.error || "No se pudo cargar el usuario.");
  }, [userId, onUnauthorized]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { closeRef.current?.focus(); }, []);
  useFocusTrap(drawerRef, true, onClose);

  const current = detail?.subscriptions.find((subscription) => live.includes(subscription.status));
  const parsed = Number(amount);
  const validAmount = amount.trim() !== "" && Number.isFinite(parsed) && Number.isInteger(parsed * 2) && (mode === "add" ? parsed !== 0 : parsed >= 0);
  const resulting = detail ? (mode === "set" ? parsed : detail.user.credits + parsed) : 0;
  const nameValue = name ?? detail?.user.name ?? "";
  const nameChanged = detail !== null && nameValue.trim() !== detail.user.name;
  const canDelete = detail !== null && deleteEmail.trim().toLowerCase() === detail.user.email.toLowerCase();

  const succeed = async (text: string) => {
    setNotice({ kind: "ok", text });
    onAction?.(text);
    await load();
    onChanged();
  };

  async function confirm() {
    if (!pending || busy) return;
    setBusy(true);
    const result = await pending.run();
    setBusy(false);
    setPending(null);
    if (result.status === 401) return onUnauthorized();
    if (result.ok) {
      setAmount("");
      await succeed(pending.success);
    } else {
      setNotice({ kind: "error", text: result.data.error || "No se pudo completar la acción." });
    }
  }

  async function saveName() {
    if (!nameChanged || busy) return;
    setBusy(true);
    setNotice(null);
    const result = await ownerFetch<{ name: string }>(`/api/owner/users/${encodeURIComponent(userId)}`, { method: "PATCH", body: { name: nameValue.trim() } });
    setBusy(false);
    if (result.status === 401) return onUnauthorized();
    if (result.ok) { setName(null); await succeed("Nombre actualizado."); }
    else setNotice({ kind: "error", text: result.data.error || "No se pudo actualizar el nombre." });
  }

  async function deleteUser() {
    if (!detail || !canDelete || busy) return;
    setBusy(true);
    setNotice(null);
    const result = await ownerFetch<{ ok: boolean; deleted: { batches?: number; leads?: number; subscriptions?: number } }>(
      `/api/owner/users/${encodeURIComponent(userId)}`,
      { method: "DELETE", body: { confirmEmail: deleteEmail.trim() } },
    );
    setBusy(false);
    if (result.status === 401) return onUnauthorized();
    if (result.ok) {
      onAction?.(`Usuario ${detail.user.email} eliminado.`);
      onChanged();
      onClose();
    } else {
      setNotice({ kind: "error", text: result.data.error || "No se pudo eliminar el usuario." });
    }
  }

  const ask = (next: Pending) => { setNotice(null); setPending(next); };

  const changeStatus = (status: "authorized" | "paused" | "cancelled", label: string, success: string) => {
    if (!current) return;
    ask({
      message: `${label} la suscripción ${planName(current.planId)} de ${detail?.user.email}?`,
      success,
      run: () => ownerFetch(`/api/owner/subscriptions/${encodeURIComponent(current.id)}`, { method: "PATCH", body: { status } }),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-(--ash-950)/45" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside ref={drawerRef} className="grid h-full w-full content-start gap-3.5 overflow-y-auto border-l border-(color:--line) bg-(--ash-100) p-5 md:w-130" role="dialog" aria-modal="true" aria-label="Detalle de usuario">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2 className="m-0 mb-1 break-all text-[17px] font-semibold tracking-tight">{detail?.user.email ?? "Usuario"}</h2>
            {detail && <p className={mutedText}>{detail.user.name || "Sin nombre"} · alta {formatDate(detail.user.created)}</p>}
          </div>
          <button ref={closeRef} className={iconButton} type="button" onClick={onClose} aria-label="Cerrar"><X size={18} aria-hidden="true" /></button>
        </header>

        {loadError && <p className={errorBox} role="alert">{loadError}</p>}
        {!detail && !loadError && <p className={stateBox} role="status">Cargando…</p>}
        {notice && <p className={notice.kind === "ok" ? okBox : errorBox} role={notice.kind === "ok" ? "status" : "alert"}>{notice.text}</p>}

        {detail && (
          <>
            <section className={blockClass} aria-label="Nombre">
              <h3 className="m-0 text-[13px] font-semibold">Nombre</h3>
              <div className="flex flex-col items-stretch gap-2 sm:flex-row">
                <label className="flex min-w-0 flex-1"><span className="sr-only">Nombre del usuario</span>
                  <input className={controlClass} type="text" maxLength={100} placeholder="Sin nombre" value={nameValue} onChange={(event) => setName(event.target.value)} />
                </label>
                <button className={primaryButton} type="button" disabled={!nameChanged || busy} onClick={() => void saveName()}>Guardar</button>
              </div>
            </section>

            <section className={blockClass} aria-label="Créditos">
              <h3 className="m-0 text-[13px] font-semibold">Créditos: <strong>{formatNumber(detail.user.credits)}</strong></h3>
              <fieldset className="m-0 flex gap-4 border-0 p-0 text-xs">
                <legend className="sr-only">Tipo de cambio</legend>
                <label className="inline-flex items-center gap-1.5"><input className="size-4 accent-(--ash-900)" type="radio" name="mode" checked={mode === "set"} onChange={() => { setMode("set"); setPending(null); }} /> Fijar</label>
                <label className="inline-flex items-center gap-1.5"><input className="size-4 accent-(--ash-900)" type="radio" name="mode" checked={mode === "add"} onChange={() => { setMode("add"); setPending(null); }} /> Sumar / restar</label>
              </fieldset>
              <div className="flex flex-col items-stretch gap-2 sm:flex-row">
                <label className="flex min-w-0 flex-1"><span className="sr-only">Cantidad de créditos</span>
                  <input className={controlClass} type="number" step="0.5" min={mode === "set" ? 0 : undefined} inputMode="decimal" placeholder={mode === "set" ? "Nuevo saldo" : "Ej: 10 o -2.5"} value={amount} onChange={(event) => { setAmount(event.target.value); setPending(null); }} />
                </label>
                <button className={primaryButton} type="button" disabled={!validAmount || busy || (mode === "add" && resulting < 0)}
                  onClick={() => ask({
                    message: mode === "set" ? `Fijar créditos en ${formatNumber(parsed)}?` : `${parsed > 0 ? "Sumar" : "Restar"} ${formatNumber(Math.abs(parsed))} créditos (saldo final ${formatNumber(resulting)})?`,
                    success: "Créditos actualizados.",
                    run: () => ownerFetch(`/api/owner/users/${encodeURIComponent(userId)}`, { method: "PATCH", body: mode === "set" ? { credits: parsed } : { addCredits: parsed } }),
                  })}>Guardar</button>
              </div>
              {amount !== "" && !validAmount && <p className={hintText}>Usá múltiplos de 0,5{mode === "set" ? " y no negativos" : ""}.</p>}
              {mode === "add" && validAmount && resulting < 0 && <p className={hintText}>El saldo no puede quedar negativo.</p>}
            </section>

            <section className={blockClass} aria-label="Membresía">
              <h3 className="m-0 text-[13px] font-semibold">Membresía</h3>
              {detail.subscriptionsHasMore && <p className={mutedText}>Mostrando los últimos 50.</p>}
              {current ? (
                <>
                  <p>{planName(current.planId)} · <span className={statusPill(current.status)}>{statusLabel(current.status)}</span> · {formatArs(current.priceArs)} / mes · {formatNumber(current.monthlyCredits)} créditos{current.manual ? " · manual" : ""}</p>
                  <div className="flex flex-wrap gap-2">
                    {current.status === "authorized" && <button className={ghostButton} type="button" disabled={busy} onClick={() => changeStatus("paused", "Pausar", "Suscripción pausada.")}>Pausar</button>}
                    {current.status === "paused" && <button className={ghostButton} type="button" disabled={busy} onClick={() => changeStatus("authorized", "Reactivar", "Suscripción reactivada.")}>Reactivar</button>}
                    <button className={dangerButton} type="button" disabled={busy} onClick={() => changeStatus("cancelled", "Cancelar", "Suscripción cancelada.")}>Cancelar</button>
                  </div>
                </>
              ) : (
                <>
                  <p className={mutedText}>Sin suscripción vigente.</p>
                  <div className="flex flex-col items-stretch gap-2 sm:flex-row">
                    <label className="flex min-w-0 flex-1"><span className="sr-only">Plan</span>
                      <select className={controlClass} value={planId} onChange={(event) => { setPlanId(event.target.value); setPending(null); }}>
                        {manualPlans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {formatArs(plan.priceArs)} · {formatNumber(plan.credits)} créditos</option>)}
                      </select>
                    </label>
                    <button className={primaryButton} type="button" disabled={busy}
                      onClick={() => ask({
                        message: `Asignar plan ${planName(planId)} a ${detail.user.email}${grant ? " y acreditar sus créditos" : ""}?`,
                        success: "Plan asignado.",
                        run: () => ownerFetch(`/api/owner/users/${encodeURIComponent(userId)}/subscription`, { method: "POST", body: { planId, grantCredits: grant } }),
                      })}>Asignar plan</button>
                  </div>
                  <label className="inline-flex items-center gap-1.5 text-xs"><input className="size-4 accent-(--ash-900)" type="checkbox" checked={grant} onChange={(event) => setGrant(event.target.checked)} /> Acreditar los créditos del plan</label>
                </>
              )}
            </section>

            {pending && (
              <div className={confirmBox} role="alertdialog" aria-label="Confirmar acción">
                <p className="m-0 text-[13px] font-semibold">{pending.message}</p>
                <div className="flex flex-wrap gap-2">
                  <button className={primaryButton} type="button" disabled={busy} onClick={() => void confirm()} autoFocus>{busy ? "Guardando…" : "Confirmar"}</button>
                  <button className={ghostButton} type="button" disabled={busy} onClick={() => setPending(null)}>Volver</button>
                </div>
              </div>
            )}

            <section className={blockClass} aria-label="Pagos">
              <h3 className="m-0 text-[13px] font-semibold">Historial de pagos</h3>
              {detail.paymentsHasMore && <p className={mutedText}>Mostrando los últimos 50.</p>}
              {detail.payments.length === 0 ? <p className={mutedText}>Sin pagos registrados.</p> : (
                <div className={tableWrap}>
                  <table className={tableClass}>
                    <thead className={theadClass}>
                      <tr>
                        <th className={thClass} scope="col">Fecha</th>
                        <th className={thClass} scope="col">Estado</th>
                        <th className={`${thClass} ${rightCell}`} scope="col">Monto</th>
                        <th className={`${thClass} ${rightCell}`} scope="col">Créditos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.payments.map((payment) => (
                        <tr className={trClass} key={payment.id}>
                          <td className={tdClass} data-label="Fecha">{formatDate(payment.created)}</td>
                          <td className={tdClass} data-label="Estado">{statusLabel(payment.status)}</td>
                          <td className={`${tdClass} ${rightCell}`} data-label="Monto">{formatArs(payment.amountArs)}</td>
                          <td className={`${tdClass} ${rightCell}`} data-label="Créditos">{formatNumber(payment.credits)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="grid gap-2.5 rounded-[10px] border border-(color:--ash-700) bg-(--paper) p-4 [&_p]:text-xs [&_p]:leading-normal" aria-label="Zona de peligro">
              <h3 className="m-0 text-[13px] font-semibold">Zona de peligro</h3>
              <p>Eliminar el usuario borra también sus búsquedas, leads y suscripciones (las de Mercado Pago se cancelan primero). No se puede deshacer.</p>
              <label className="grid gap-1.5 text-xs">
                Escribí <strong className="break-all">{detail.user.email}</strong> para confirmar
                <input className={controlClass} type="text" autoComplete="off" value={deleteEmail} onChange={(event) => setDeleteEmail(event.target.value)} />
              </label>
              <div>
                <button className={dangerButton} type="button" disabled={!canDelete || busy} onClick={() => void deleteUser()}><Trash2 size={14} aria-hidden="true" /> Eliminar usuario</button>
              </div>
            </section>
          </>
        )}
      </aside>
    </div>
  );
}
