"use client";

import { useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import {
  confirmBox, dangerButton, errorBox, formatDate, formatNumber, ghostButton, mutedText, okBox, ownerFetch, rightCell,
  smallButton, stateBox, statusLabel, statusPill, tableClass, tableWrap, tdClass, theadClass, thClass, trClass,
  isUnauthorized, useFocusTrap, useOwnerList, type OnAction,
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

const statusOptions = ["running", "completed", "partial", "failed"].map((value) => ({ value, label: statusLabel(value) }));
const zone = (batch: Batch) => [batch.district, batch.province, batch.country].filter(Boolean).join(", ");

export default function SearchesSection({ onUnauthorized, onAction }: { onUnauthorized: () => void; onAction?: OnAction }) {
  const list = useOwnerList<Batch>("/api/owner/batches", "No se pudieron cargar las búsquedas.", onUnauthorized);
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
      const deleted = result.data.deletedLeads ?? 0;
      const text = `Búsqueda eliminada junto con ${formatNumber(deleted)} ${deleted === 1 ? "lead" : "leads"}.`;
      setNotice({ kind: "ok", text });
      onAction?.(text);
      void reload();
    } else {
      setNotice({ kind: "error", text: result.data.error || "No se pudo eliminar la búsqueda." });
      void reload();
    }
  }

  return (
    <section aria-label="Búsquedas">
      <ListToolbar title="Búsquedas" total={data?.totalItems} query={list.query} onQuery={list.setQuery} status={list.status} onStatus={list.setStatus} statusOptions={statusOptions} onRefresh={() => void reload()} />
      {error && <p className={errorBox} role="alert">{error}</p>}
      {notice && <p className={notice.kind === "ok" ? okBox : errorBox} role={notice.kind === "ok" ? "status" : "alert"}>{notice.text}</p>}
      {target && (
        <div ref={dialogRef} className={`${confirmBox} mb-3.5`} role="alertdialog" aria-label="Confirmar eliminación">
          <p className="m-0 text-[13px] font-semibold">
            ¿Eliminar la búsqueda “{target.keywords || "sin rubro"}” de {target.userEmail || "un usuario"}? Se borrarán también sus leads (hasta {formatNumber(target.resultCount)}) y no se puede deshacer.
          </p>
          <div className="flex flex-wrap gap-2">
            <button className={dangerButton} type="button" disabled={busy} onClick={() => void remove()}>{busy ? "Eliminando…" : "Eliminar definitivamente"}</button>
            <button className={ghostButton} type="button" disabled={busy} onClick={closeTarget} autoFocus>Volver</button>
          </div>
        </div>
      )}
      <div className={`${tableWrap}${loading ? " opacity-60 transition-opacity" : ""}`} aria-busy={loading}>
        <table className={tableClass}>
          <thead className={theadClass}>
            <tr>
              <th className={thClass} scope="col">Fecha</th>
              <th className={thClass} scope="col">Usuario</th>
              <th className={thClass} scope="col">Rubro</th>
              <th className={thClass} scope="col">Zona</th>
              <th className={`${thClass} ${rightCell}`} scope="col">Pedidos / resultados</th>
              <th className={thClass} scope="col">Estado</th>
              <th className={thClass} scope="col"><span className="sr-only">Acciones</span></th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((batch) => (
              <tr className={trClass} key={batch.id}>
                <td className={tdClass} data-label="Fecha">{formatDate(batch.createdAt)}</td>
                <td className={`${tdClass} break-all`} data-label="Usuario">{batch.userEmail || <span className={mutedText}>Sin usuario</span>}</td>
                <td className={tdClass} data-label="Rubro">{batch.keywords || "—"}</td>
                <td className={tdClass} data-label="Zona">{zone(batch) || "—"}</td>
                <td className={`${tdClass} ${rightCell}`} data-label="Pedidos / resultados">{formatNumber(batch.requestedCount)} / {formatNumber(batch.resultCount)}</td>
                <td className={tdClass} data-label="Estado"><span className={statusPill(batch.status)}>{statusLabel(batch.status)}</span></td>
                <td className={`${tdClass} max-md:justify-end`}>
                  <button className={`${dangerButton} ${smallButton}`} type="button" disabled={busy} onClick={(event) => { openerRef.current = event.currentTarget; setNotice(null); setTarget(batch); }} aria-label={`Eliminar búsqueda ${batch.keywords || batch.id}`}>
                    <Trash2 size={14} aria-hidden="true" /> Eliminar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data && loading && <p className={stateBox} role="status">Cargando búsquedas…</p>}
        {data && data.items.length === 0 && !loading && <p className={stateBox}>{list.query || list.status ? "Sin resultados para ese filtro." : "Todavía no hay búsquedas."}</p>}
      </div>
      <Pager page={list.page} totalPages={data?.totalPages ?? 1} loading={loading} onPage={list.setPage} />
    </section>
  );
}
