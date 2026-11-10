"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, LoaderCircle, LogOut, RefreshCw, Search, X } from "lucide-react";
import { BrandLogo } from "@/app/brand-logo";
import { subscriptionPlans } from "@/lib/plans";
import styles from "./owner.module.css";

type SubscriptionSummary = { id: string; planId: string; status: string; priceArs: number; monthlyCredits: number };
type Overview = {
  mrrArs: number;
  activeSubscriptions: number;
  pausedSubscriptions: number;
  totalUsers: number;
  newUsers30d: number;
  creditsInCirculation: number;
  revenue30dArs: number;
  planBreakdown: { planId: string; count: number; mrrArs: number }[];
};
type UserRow = { id: string; email: string; name: string; credits: number; created: string; subscription: SubscriptionSummary | null };
type UsersPage = { items: UserRow[]; page: number; totalPages: number; totalItems: number };
type UserDetail = {
  user: { id: string; email: string; name: string; credits: number; created: string };
  subscriptions: (SubscriptionSummary & { externalReference?: string; manual: boolean; created: string })[];
  subscriptionsHasMore?: boolean;
  paymentsHasMore?: boolean;
  payments: { id: string; paymentId: string; status: string; amountArs: number; credits: number; created: string }[];
};
type Result<T> = { ok: boolean; status: number; data: T & { error?: string } };

const perPage = 25;
const manualPlans = subscriptionPlans.filter((plan) => ["initial", "pro", "agency"].includes(plan.id));
const live = ["authorized", "paused", "pending"];
const statusLabels: Record<string, string> = {
  authorized: "Activa",
  paused: "Pausada",
  pending: "Pendiente",
  creating: "Creando",
  cancelled: "Cancelada",
  canceled: "Cancelada",
  approved: "Aprobado",
  processed: "Acreditado",
  rejected: "Rechazado",
};

const ars = (value: number) => `$${Math.round(value || 0).toLocaleString("es-AR")}`;
const num = (value: number) => (value || 0).toLocaleString("es-AR", { maximumFractionDigits: 1 });
const date = (value: string) => (value ? new Date(value.replace(" ", "T")).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const planName = (id: string) => subscriptionPlans.find((plan) => plan.id === id)?.name ?? id;
const statusLabel = (status: string) => statusLabels[status] ?? status;

async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<Result<T>> {
  try {
    const response = await fetch(path, {
      method: init?.method ?? "GET",
      cache: "no-store",
      headers: init?.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: "No se pudo conectar. Revisá tu conexión." } as Result<T>["data"] };
  }
}

export default function OwnerPanel() {
  const [auth, setAuth] = useState<"loading" | "owner" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const router = useRouter();
  // Without an owner session there is nothing to show here: send the user back to the app.
  const leavePanel = useCallback(() => router.replace("/buscar"), [router]);

  useEffect(() => {
    let active = true;
    api("/api/owner/me").then((result) => {
      if (!active) return;
      if (result.ok) setAuth("owner");
      else if (result.status === 401 || result.status === 403) leavePanel();
      else setAuth("error");
    });
    return () => { active = false; };
  }, [attempt, leavePanel]);

  function retry() {
    setAuth("loading");
    setAttempt((value) => value + 1);
  }

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    leavePanel();
  }

  return (
    <main className={styles.shell}>
      <header className={styles.topbar}>
        <BrandLogo />
        <span className={styles.badge}>Owner</span>
        {auth === "owner" && (
          <button className={styles.ghost} type="button" onClick={() => void logout()}>
            <LogOut size={15} aria-hidden="true" /> Salir
          </button>
        )}
      </header>
      {auth === "loading" && <p className={styles.state} role="status"><LoaderCircle className={styles.spin} size={16} aria-hidden="true" /> Cargando…</p>}
      {auth === "error" && (
        <div className={styles.state} role="alert">
          <span>No se pudo verificar la sesión. Revisá tu conexión o el servidor.</span>
          <button className={styles.ghost} type="button" onClick={retry}><RefreshCw size={15} aria-hidden="true" /> Reintentar</button>
        </div>
      )}
      {auth === "owner" && <Dashboard onUnauthorized={leavePanel} />}
    </main>
  );
}

function Dashboard({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [overviewError, setOverviewError] = useState("");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [users, setUsers] = useState<UsersPage | null>(null);
  const [usersError, setUsersError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState("");
  const requestId = useRef(0);
  const overviewRequestId = useRef(0);
  const openerRef = useRef<HTMLElement | null>(null);
  const closeDrawer = useCallback(() => {
    setSelected("");
    window.setTimeout(() => openerRef.current?.focus(), 0);
  }, []);

  const loadOverview = useCallback(async () => {
    const id = ++overviewRequestId.current;
    const result = await api<Overview>("/api/owner/overview");
    if (id !== overviewRequestId.current) return;
    if (result.status === 401 || result.status === 403) return onUnauthorized();
    if (result.ok) { setOverview(result.data); setOverviewError(""); }
    else setOverviewError(result.data.error || "No se pudieron cargar las métricas.");
  }, [onUnauthorized]);

  const loadUsers = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    const result = await api<UsersPage>(`/api/owner/users?page=${page}&perPage=${perPage}&q=${encodeURIComponent(search)}`);
    if (id !== requestId.current) return;
    setLoading(false);
    if (result.status === 401 || result.status === 403) return onUnauthorized();
    if (result.ok) { setUsers(result.data); setUsersError(""); }
    else setUsersError(result.data.error || "No se pudieron cargar los usuarios.");
  }, [page, search, onUnauthorized]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount; state set after await
  useEffect(() => { void loadOverview(); }, [loadOverview]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- refetch on page/search change
  useEffect(() => { void loadUsers(); }, [loadUsers]);
  useEffect(() => {
    const timer = window.setTimeout(() => { setPage(1); setSearch(query.trim()); }, 350);
    return () => window.clearTimeout(timer);
  }, [query]);

  const refresh = useCallback(() => { void loadOverview(); void loadUsers(); }, [loadOverview, loadUsers]);

  const cards: [string, string][] = overview ? [
    ["MRR", ars(overview.mrrArs)],
    ["Suscripciones activas", num(overview.activeSubscriptions)],
    ["Suscripciones pausadas", num(overview.pausedSubscriptions)],
    ["Usuarios totales", num(overview.totalUsers)],
    ["Nuevos (30 días)", num(overview.newUsers30d)],
    ["Créditos en circulación", num(overview.creditsInCirculation)],
    ["Ingresos (30 días)", ars(overview.revenue30dArs)],
  ] : [];

  return (
    <div className={styles.workspace}>
      <section aria-label="Resumen">
        <div className={styles.sectionHead}>
          <h1>Resumen</h1>
          <button className={styles.ghost} type="button" onClick={refresh}><RefreshCw size={15} aria-hidden="true" /> Actualizar</button>
        </div>
        {overviewError && <p className={styles.error} role="alert">{overviewError}</p>}
        {!overview && !overviewError && <p className={styles.state} role="status">Cargando métricas…</p>}
        {overview && (
          <>
            <dl className={styles.cards}>
              {cards.map(([label, value]) => (
                <div className={styles.card} key={label}><dt>{label}</dt><dd>{value}</dd></div>
              ))}
            </dl>
            <div className={styles.breakdown}>
              <h2>Por plan</h2>
              {overview.planBreakdown.length === 0 ? <p className={styles.muted}>Sin suscripciones activas.</p> : (
                <ul>
                  {overview.planBreakdown.map((row) => (
                    <li key={row.planId}><strong>{planName(row.planId)}</strong><span>{num(row.count)} {row.count === 1 ? "suscripción" : "suscripciones"}</span><span>{ars(row.mrrArs)} / mes</span></li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </section>

      <section aria-label="Usuarios">
        <div className={styles.sectionHead}>
          <h2>Usuarios{users ? <span className={styles.count}>{num(users.totalItems)}</span> : null}</h2>
          <label className={styles.search}>
            <Search size={15} aria-hidden="true" />
            <span className={styles.srOnly}>Buscar por email o nombre</span>
            <input type="search" placeholder="Buscar email o nombre" value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
        </div>
        {usersError && <p className={styles.error} role="alert">{usersError}</p>}
        <div className={`${styles.tableWrap}${loading ? ` ${styles.dim}` : ""}`} aria-busy={loading}>
          <table className={styles.table}>
            <thead><tr><th scope="col">Email</th><th scope="col">Nombre</th><th scope="col" className={styles.right}>Créditos</th><th scope="col">Plan</th><th scope="col">Alta</th></tr></thead>
            <tbody>
              {users?.items.map((user) => (
                <tr key={user.id}>
                  <td data-label="Email"><button type="button" className={styles.rowButton} onClick={(event) => { openerRef.current = event.currentTarget; setSelected(user.id); }}>{user.email}</button></td>
                  <td data-label="Nombre">{user.name || "—"}</td>
                  <td data-label="Créditos" className={styles.right}>{num(user.credits)}</td>
                  <td data-label="Plan">{user.subscription ? <>{planName(user.subscription.planId)} <span className={`${styles.pill} ${styles[`s_${user.subscription.status}`] ?? ""}`}>{statusLabel(user.subscription.status)}</span></> : <span className={styles.muted}>Sin plan</span>}</td>
                  <td data-label="Alta">{date(user.created)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {users && users.items.length === 0 && !loading && <p className={styles.state}>{search ? "Sin resultados para esa búsqueda." : "Todavía no hay usuarios."}</p>}
          {!users && loading && <p className={styles.state} role="status">Cargando usuarios…</p>}
        </div>
        {users && users.totalPages > 1 && (
          <nav className={styles.pager} aria-label="Paginación">
            <button className={styles.ghost} type="button" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}><ChevronLeft size={15} aria-hidden="true" /> Anterior</button>
            <span>Página {users.page} de {users.totalPages}</span>
            <button className={styles.ghost} type="button" disabled={page >= users.totalPages || loading} onClick={() => setPage(page + 1)}>Siguiente <ChevronRight size={15} aria-hidden="true" /></button>
          </nav>
        )}
      </section>

      {selected && <UserDrawer userId={selected} onClose={closeDrawer} onChanged={refresh} onUnauthorized={onUnauthorized} />}
    </div>
  );
}

type Pending = { message: string; run: () => Promise<Result<unknown>>; success: string };

function UserDrawer({ userId, onClose, onChanged, onUnauthorized }: { userId: string; onClose: () => void; onChanged: () => void; onUnauthorized: () => void }) {
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [loadError, setLoadError] = useState("");
  const [mode, setMode] = useState<"set" | "add">("set");
  const [amount, setAmount] = useState("");
  const [planId, setPlanId] = useState<string>(manualPlans[0]?.id ?? "initial");
  const [grant, setGrant] = useState(true);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);

  const load = useCallback(async () => {
    const result = await api<UserDetail>(`/api/owner/users/${encodeURIComponent(userId)}`);
    if (result.status === 401 || result.status === 403) return onUnauthorized();
    if (result.ok) { setDetail(result.data); setLoadError(""); }
    else setLoadError(result.data.error || "No se pudo cargar el usuario.");
  }, [userId, onUnauthorized]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount
  useEffect(() => { void load(); }, [load]);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") return onCloseRef.current();
      const root = drawerRef.current;
      if (event.key !== "Tab" || !root) return;
      const items = Array.from(root.querySelectorAll<HTMLElement>("button, input, select, a[href]")).filter((item) => !(item as HTMLButtonElement).disabled);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;
      if (!root.contains(current) || (event.shiftKey && current === first)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && current === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const current = detail?.subscriptions.find((subscription) => live.includes(subscription.status));
  const parsed = Number(amount);
  const validAmount = amount.trim() !== "" && Number.isFinite(parsed) && Number.isInteger(parsed * 2) && (mode === "add" ? parsed !== 0 : parsed >= 0);
  const resulting = detail ? (mode === "set" ? parsed : detail.user.credits + parsed) : 0;

  async function confirm() {
    if (!pending || busy) return;
    setBusy(true);
    const result = await pending.run();
    setBusy(false);
    setPending(null);
    if (result.status === 401 || result.status === 403) return onUnauthorized();
    if (result.ok) {
      setNotice({ kind: "ok", text: pending.success });
      setAmount("");
      await load();
      onChanged();
    } else {
      setNotice({ kind: "error", text: result.data.error || "No se pudo completar la acción." });
    }
  }

  const ask = (next: Pending) => { setNotice(null); setPending(next); };

  const changeStatus = (status: "authorized" | "paused" | "cancelled", label: string, success: string) => {
    if (!current) return;
    ask({
      message: `${label} la suscripción ${planName(current.planId)} de ${detail?.user.email}?`,
      success,
      run: () => api(`/api/owner/subscriptions/${encodeURIComponent(current.id)}`, { method: "PATCH", body: { status } }),
    });
  };

  return (
    <div className={styles.overlay} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside ref={drawerRef} className={styles.drawer} role="dialog" aria-modal="true" aria-label="Detalle de usuario">
        <header className={styles.drawerHead}>
          <div>
            <h2>{detail?.user.email ?? "Usuario"}</h2>
            {detail && <p className={styles.muted}>{detail.user.name || "Sin nombre"} · alta {date(detail.user.created)}</p>}
          </div>
          <button ref={closeRef} className={styles.iconButton} type="button" onClick={onClose} aria-label="Cerrar"><X size={18} aria-hidden="true" /></button>
        </header>

        {loadError && <p className={styles.error} role="alert">{loadError}</p>}
        {!detail && !loadError && <p className={styles.state} role="status">Cargando…</p>}
        {notice && <p className={notice.kind === "ok" ? styles.okNote : styles.error} role={notice.kind === "ok" ? "status" : "alert"}>{notice.text}</p>}

        {detail && (
          <>
            <section className={styles.block} aria-label="Créditos">
              <h3>Créditos: <strong>{num(detail.user.credits)}</strong></h3>
              <fieldset className={styles.modes}>
                <legend className={styles.srOnly}>Tipo de cambio</legend>
                <label><input type="radio" name="mode" checked={mode === "set"} onChange={() => { setMode("set"); setPending(null); }} /> Fijar</label>
                <label><input type="radio" name="mode" checked={mode === "add"} onChange={() => { setMode("add"); setPending(null); }} /> Sumar / restar</label>
              </fieldset>
              <div className={styles.inline}>
                <label className={styles.field}><span className={styles.srOnly}>Cantidad de créditos</span>
                  <input type="number" step="0.5" min={mode === "set" ? 0 : undefined} inputMode="decimal" placeholder={mode === "set" ? "Nuevo saldo" : "Ej: 10 o -2.5"} value={amount} onChange={(event) => { setAmount(event.target.value); setPending(null); }} />
                </label>
                <button className={styles.primary} type="button" disabled={!validAmount || busy || (mode === "add" && resulting < 0)}
                  onClick={() => ask({
                    message: mode === "set" ? `Fijar créditos en ${num(parsed)}?` : `${parsed > 0 ? "Sumar" : "Restar"} ${num(Math.abs(parsed))} créditos (saldo final ${num(resulting)})?`,
                    success: "Créditos actualizados.",
                    run: () => api(`/api/owner/users/${encodeURIComponent(userId)}`, { method: "PATCH", body: mode === "set" ? { credits: parsed } : { addCredits: parsed } }),
                  })}>Guardar</button>
              </div>
              {amount !== "" && !validAmount && <p className={styles.hint}>Usá múltiplos de 0,5{mode === "set" ? " y no negativos" : ""}.</p>}
              {mode === "add" && validAmount && resulting < 0 && <p className={styles.hint}>El saldo no puede quedar negativo.</p>}
            </section>

            <section className={styles.block} aria-label="Membresía">
              <h3>Membresía</h3>
              {detail.subscriptionsHasMore && <p className={styles.muted}>Mostrando los últimos 50.</p>}
              {current ? (
                <>
                  <p>{planName(current.planId)} · <span className={`${styles.pill} ${styles[`s_${current.status}`] ?? ""}`}>{statusLabel(current.status)}</span> · {ars(current.priceArs)} / mes · {num(current.monthlyCredits)} créditos{detail.subscriptions.find((s) => s.id === current.id)?.manual ? " · manual" : ""}</p>
                  <div className={styles.actions}>
                    {current.status === "authorized" && <button className={styles.ghost} type="button" disabled={busy} onClick={() => changeStatus("paused", "Pausar", "Suscripción pausada.")}>Pausar</button>}
                    {current.status === "paused" && <button className={styles.ghost} type="button" disabled={busy} onClick={() => changeStatus("authorized", "Reactivar", "Suscripción reactivada.")}>Reactivar</button>}
                    <button className={styles.danger} type="button" disabled={busy} onClick={() => changeStatus("cancelled", "Cancelar", "Suscripción cancelada.")}>Cancelar</button>
                  </div>
                </>
              ) : (
                <>
                  <p className={styles.muted}>Sin suscripción vigente.</p>
                  <div className={styles.inline}>
                    <label className={styles.field}><span className={styles.srOnly}>Plan</span>
                      <select value={planId} onChange={(event) => { setPlanId(event.target.value); setPending(null); }}>
                        {manualPlans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {ars(plan.priceArs)} · {num(plan.credits)} créditos</option>)}
                      </select>
                    </label>
                    <button className={styles.primary} type="button" disabled={busy}
                      onClick={() => ask({
                        message: `Asignar plan ${planName(planId)} a ${detail.user.email}${grant ? " y acreditar sus créditos" : ""}?`,
                        success: "Plan asignado.",
                        run: () => api(`/api/owner/users/${encodeURIComponent(userId)}/subscription`, { method: "POST", body: { planId, grantCredits: grant } }),
                      })}>Asignar plan</button>
                  </div>
                  <label className={styles.check}><input type="checkbox" checked={grant} onChange={(event) => setGrant(event.target.checked)} /> Acreditar los créditos del plan</label>
                </>
              )}
            </section>

            {pending && (
              <div className={styles.confirm} role="alertdialog" aria-label="Confirmar acción">
                <p>{pending.message}</p>
                <div className={styles.actions}>
                  <button className={styles.primary} type="button" disabled={busy} onClick={() => void confirm()} autoFocus>{busy ? "Guardando…" : "Confirmar"}</button>
                  <button className={styles.ghost} type="button" disabled={busy} onClick={() => setPending(null)}>Volver</button>
                </div>
              </div>
            )}

            <section className={styles.block} aria-label="Pagos">
              <h3>Historial de pagos</h3>
              {detail.paymentsHasMore &&<p className={styles.muted}>Mostrando los últimos 50.</p>}
              {detail.payments.length === 0 ? <p className={styles.muted}>Sin pagos registrados.</p> : (
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead><tr><th scope="col">Fecha</th><th scope="col">Estado</th><th scope="col" className={styles.right}>Monto</th><th scope="col" className={styles.right}>Créditos</th></tr></thead>
                    <tbody>
                      {detail.payments.map((payment) => (
                        <tr key={payment.id}>
                          <td data-label="Fecha">{date(payment.created)}</td>
                          <td data-label="Estado">{statusLabel(payment.status)}</td>
                          <td data-label="Monto" className={styles.right}>{ars(payment.amountArs)}</td>
                          <td data-label="Créditos" className={styles.right}>{num(payment.credits)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </aside>
    </div>
  );
}
