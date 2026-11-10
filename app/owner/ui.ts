import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { subscriptionPlans } from "@/lib/plans";

// Tailwind class constants and helpers shared by the owner sections (copied from owner-panel.tsx).
const btn = "inline-flex min-h-10 cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-3.5 text-xs! font-semibold! focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(color:--ash-950) disabled:cursor-not-allowed disabled:opacity-50";
export const ghostButton = `${btn} border-(color:--ash-300) bg-(--paper) text-(color:--ink) enabled:hover:bg-(--ash-50)`;
export const primaryButton = `${btn} border-(color:--lime-dark) bg-(--lime) text-(color:--ink) enabled:hover:bg-(--lime-dark)`;
export const dangerButton = `${btn} border-(color:--ash-700) bg-(--paper) text-(color:--ash-950) enabled:hover:bg-(--ash-950) enabled:hover:text-(color:--paper)!`;
export const smallButton = "min-h-9 px-2.5";
export const controlClass = "min-h-10 w-full rounded-lg border border-(color:--ash-300) bg-(--paper) px-3 text-[13px] text-(color:--ink) focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(color:--ash-800)";
export const errorBox = "mb-3 rounded-lg border border-(color:--ash-400) bg-(--ash-50) px-3 py-2.5 text-xs leading-snug text-(color:--ash-900)";
export const okBox = "mb-3 rounded-lg bg-(--lime) px-3 py-2.5 text-xs font-semibold text-(color:--ink)";
export const stateBox = "flex items-center gap-2 p-4 text-[13px] text-(color:--muted)";
export const mutedText = "text-xs text-(color:--muted)";
export const sectionHead = "mb-3.5 flex flex-wrap items-center justify-between gap-3";
export const sectionTitle = "m-0 flex items-center gap-2 text-xl font-semibold tracking-tight";
export const countBadge = "rounded-full bg-(--ash-200) px-2 py-0.5 text-[11px] font-semibold text-(color:--ash-700)";
export const cardClass = "rounded-[10px] border border-(color:--line) bg-(--paper) p-4";
export const tableWrap = "overflow-x-auto rounded-[10px] border border-(color:--line) bg-(--paper)";
export const tableClass = "w-full border-collapse text-[13px] max-md:block max-md:[&_tbody]:block [&_tr:last-child_td]:border-b-0";
export const theadClass = "max-md:sr-only";
export const thClass = "whitespace-nowrap border-b border-(color:--line) px-3.5 py-2.5 text-left text-[11px] font-semibold text-(color:--muted)";
export const tdClass = "border-b border-(color:--ash-150) px-3.5 py-2.5 align-middle max-md:flex max-md:justify-between max-md:gap-3 max-md:border-0 max-md:px-0 max-md:py-[3px] max-md:text-right max-md:before:text-left max-md:before:text-[11px] max-md:before:text-(color:--muted) max-md:before:content-[attr(data-label)]";
export const trClass = "hover:bg-(--ash-50) max-md:block max-md:border-b max-md:border-(color:--ash-150) max-md:px-3.5 max-md:py-2.5";
export const rightCell = "text-right tabular-nums";
export const hintText = "text-[11px] text-(color:--ash-700)";
export const blockClass = "grid gap-2.5 rounded-[10px] border border-(color:--line) bg-(--paper) p-4 [&_p]:text-xs [&_p]:leading-normal";
export const iconButton = "inline-grid size-10 cursor-pointer place-items-center rounded-lg border border-(color:--ash-300) bg-(--paper) text-(color:--ink) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(color:--ash-950)";
export const confirmBox = "grid gap-2.5 rounded-[10px] border border-(color:--ash-950) bg-(--paper) px-4 py-3.5";

export const statusLabels: Record<string, string> = {
  authorized: "Activa",
  paused: "Pausada",
  pending: "Pendiente",
  creating: "Creando",
  cancelled: "Cancelada",
  canceled: "Cancelada",
  approved: "Aprobado",
  processing: "Procesando",
  processed: "Acreditado",
  rejected: "Rechazado",
  failed: "Fallido",
  refunded: "Reembolsado",
  running: "En curso",
  completed: "Completada",
  partial: "Parcial",
};

export const statusLabel = (status: string) => statusLabels[status] ?? status;

export const statusPill = (status: string) =>
  `inline-block rounded-full px-[7px] py-0.5 text-[10px] font-bold ${
    ["authorized", "processed", "completed"].includes(status) ? "bg-(--lime) text-(color:--ink)"
      : ["cancelled", "canceled", "rejected", "failed"].includes(status) ? "bg-(--ash-150) text-(color:--ash-600)"
      : "bg-(--ash-200) text-(color:--ash-800)"
  }`;

/** Optional callback sections call after a successful action so the shell can show a visible notice. */
export type OnAction = (message: string) => void;

export const planName = (id: string) => subscriptionPlans.find((plan) => plan.id === id)?.name ?? id;

export const actionLabels: Record<string, string> = {
  "user.credits_set": "Créditos fijados",
  "user.credits_add": "Créditos sumados/restados",
  "user.update": "Usuario editado",
  "user.delete": "Usuario eliminado",
  "subscription.assign": "Plan asignado",
  "subscription.status": "Estado de suscripción",
  "subscription.plan": "Plan cambiado",
  "batch.delete": "Búsqueda eliminada",
};
export const actionLabel = (action: string) => actionLabels[action] ?? action;

const detailLabels: Record<string, string> = {
  name: "Nombre",
  email: "Email",
  creditsBefore: "Créditos antes",
  creditsAfter: "Créditos después",
  delta: "Variación",
  status: "Estado",
  planId: "Plan",
  priceArs: "Precio",
  monthlyCredits: "Créditos mensuales",
  mercadoPago: "En Mercado Pago",
  mercadoPagoCancelled: "Canceladas en Mercado Pago",
  grantCredits: "Créditos del plan acreditados",
  userId: "ID de usuario",
  ownerEmail: "Usuario",
  ownerId: "ID de usuario",
  keywords: "Rubro",
  zone: "Zona",
  deletedLeads: "Leads eliminados",
  batches: "Búsquedas eliminadas",
  leads: "Leads eliminados",
  subscriptions: "Suscripciones eliminadas",
};

function detailValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (typeof value === "number") return key === "priceArs" ? formatArs(value) : formatNumber(value);
  if (Array.isArray(value)) return value.map((item) => String(item)).join(", ") || "—";
  if (typeof value === "string") return key === "planId" ? planName(value) : key === "status" ? statusLabel(value) : value;
  return JSON.stringify(value);
}

/** Turns an audit `details` object into readable [label, text] rows (before → after when both exist). */
export function describeDetails(details: unknown): [string, string][] {
  if (!details || typeof details !== "object" || Array.isArray(details)) return [];
  return Object.entries(details as Record<string, unknown>).map(([key, value]) => {
    const label = detailLabels[key] ?? key;
    if (value && typeof value === "object" && !Array.isArray(value) && "before" in value && "after" in value) {
      const change = value as { before: unknown; after: unknown };
      return [label, `${detailValue(key, change.before)} → ${detailValue(key, change.after)}`];
    }
    return [label, detailValue(key, value)];
  });
}

export const formatDateTime = (value: string) => {
  if (!value) return "—";
  const parsed = new Date(value.replace(" ", "T"));
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString("es-AR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

export const formatArs = (value: number) => `$${Math.round(value || 0).toLocaleString("es-AR")}`;
export const formatNumber = (value: number) => (value || 0).toLocaleString("es-AR", { maximumFractionDigits: 1 });
export const formatDate = (value: string) => {
  if (!value) return "—";
  const parsed = new Date(value.replace(" ", "T"));
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
};

export type OwnerResult<T> = { ok: boolean; status: number; data: T & { error?: string } };

export const isUnauthorized = (status: number) => status === 401 || status === 403;

export async function ownerFetch<T>(path: string, init?: { method?: string; body?: unknown }): Promise<OwnerResult<T>> {
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
    return { ok: false, status: 0, data: { error: "No se pudo conectar. Revisá tu conexión." } as OwnerResult<T>["data"] };
  }
}

export type ListPage<T> = { items: T[]; page: number; totalPages: number; totalItems: number };

/** Paginated list with debounced search, status filter and protection against stale responses. */
export function useOwnerList<T>(endpoint: string, errorMessage: string, onUnauthorized: () => void, filterKey = "status") {
  const [query, setQueryState] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatusState] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListPage<T> | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const requestId = useRef(0);
  const unauthorizedRef = useRef(onUnauthorized);
  useEffect(() => { unauthorizedRef.current = onUnauthorized; });

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), perPage: "25", q: search });
    if (status) params.set(filterKey, status);
    const result = await ownerFetch<ListPage<T>>(`${endpoint}?${params}`);
    if (id !== requestId.current) return;
    setLoading(false);
    if (isUnauthorized(result.status)) return unauthorizedRef.current();
    if (result.ok) { setData(result.data); setError(""); }
    else setError(result.data.error || errorMessage);
  }, [endpoint, errorMessage, filterKey, page, search, status]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- refetch on page/search/status change
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer = window.setTimeout(() => { setPage(1); setSearch(query.trim()); }, 350);
    return () => window.clearTimeout(timer);
  }, [query]);

  const setQuery = useCallback((value: string) => setQueryState(value), []);
  const setStatus = useCallback((value: string) => { setPage(1); setStatusState(value); }, []);

  return { data, error, loading, page, setPage, query, setQuery, status, setStatus, reload: load };
}

/** Traps Tab/Shift+Tab inside `containerRef` and calls `onEscape` on Esc while `active`. */
export function useFocusTrap(containerRef: RefObject<HTMLElement | null>, active: boolean, onEscape: () => void) {
  const escapeRef = useRef(onEscape);
  useEffect(() => { escapeRef.current = onEscape; });
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") return escapeRef.current();
      const root = containerRef.current;
      if (event.key !== "Tab" || !root) return;
      const items = Array.from(root.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href]")).filter((item) => !(item as HTMLButtonElement).disabled);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;
      if (!root.contains(current) || (event.shiftKey && current === first)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && current === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, containerRef]);
}
