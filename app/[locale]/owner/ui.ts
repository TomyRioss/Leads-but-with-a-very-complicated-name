import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useLocale, useTranslations } from "next-intl";
import { getSubscriptionPlan, isExclusivePlan, subscriptionPlans } from "@/lib/plans";

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

export const exclusivePill = "inline-flex items-center rounded-full bg-(--lime) px-2 py-0.5 text-[11px] font-semibold text-(color:--ink)";
export const statusPill = (status: string) =>
  `inline-block rounded-full px-[7px] py-0.5 text-[10px] font-bold ${
    ["authorized", "processed", "completed"].includes(status) ? "bg-(--lime) text-(color:--ink)"
      : ["cancelled", "canceled", "rejected", "failed"].includes(status) ? "bg-(--ash-150) text-(color:--ash-600)"
      : "bg-(--ash-200) text-(color:--ash-800)"
  }`;

/** Optional callback sections call after a successful action so the shell can show a visible notice. */
export type OnAction = (message: string) => void;

/** Audit action ids, in the order shown by the audit filter. Message keys replace "." with "_". */
export const auditActions = ["user.credits_set", "user.credits_add", "user.update", "user.delete", "subscription.assign", "subscription.status", "subscription.plan", "batch.delete"];

/** Sentinel returned by ownerFetch when the request never reached the server; callers show a localized message. */
const NETWORK_ERROR = "__network__";

/** Locale-aware formatters and labels shared by the owner sections. */
export function useOwnerFormat() {
  const t = useTranslations("Owner");
  const locale = useLocale();
  return useMemo(() => {
    const tag = locale === "en" ? "en-US" : "es-AR";
    const numberFormat = new Intl.NumberFormat(tag, { maximumFractionDigits: 1 });
    const arsFormat = new Intl.NumberFormat(tag, { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
    const dateFormat = new Intl.DateTimeFormat(tag, { day: "2-digit", month: "short", year: "numeric" });
    const dateTimeFormat = new Intl.DateTimeFormat(tag, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    const parse = (value: string) => {
      if (!value) return null;
      const parsed = new Date(value.replace(" ", "T"));
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    };

    const formatNumber = (value: number) => numberFormat.format(value || 0);
    const formatArs = (value: number) => arsFormat.format(Math.round(value || 0));
    const formatDate = (value: string) => { const parsed = parse(value); return parsed ? dateFormat.format(parsed) : "—"; };
    const formatDateTime = (value: string) => { const parsed = parse(value); return parsed ? dateTimeFormat.format(parsed) : "—"; };
    const statusLabel = (status: string) => (t.has(`status.${status}`) ? t(`status.${status}`) : status);
    const planName = (id: string) => (t.has(`plans.${id}`) ? t(`plans.${id}`) : (getSubscriptionPlan(id)?.name ?? id));
    const isExclusive = (id: string) => isExclusivePlan(subscriptionPlans, id);
    const actionLabel = (action: string) => { const key = `actions.${action.replace(".", "_")}`; return t.has(key) ? t(key) : action; };
    const errorText = (error: string | undefined, fallback: string) => (error === NETWORK_ERROR ? t("common.networkError") : error || fallback);

    const detailValue = (key: string, value: unknown): string => {
      if (value === null || value === undefined || value === "") return "—";
      if (typeof value === "boolean") return value ? t("common.yes") : t("common.no");
      if (typeof value === "number") return key === "priceArs" ? formatArs(value) : formatNumber(value);
      if (Array.isArray(value)) return value.map((item) => String(item)).join(", ") || "—";
      if (typeof value === "string") return key === "planId" ? planName(value) : key === "status" ? statusLabel(value) : value;
      return JSON.stringify(value);
    };

    /** Turns an audit `details` object into readable [label, text] rows (before → after when both exist). */
    const describeDetails = (details: unknown): [string, string][] => {
      if (!details || typeof details !== "object" || Array.isArray(details)) return [];
      return Object.entries(details as Record<string, unknown>).map(([key, value]) => {
        const label = t.has(`detail.${key}`) ? t(`detail.${key}`) : key;
        if (value && typeof value === "object" && !Array.isArray(value) && "before" in value && "after" in value) {
          const change = value as { before: unknown; after: unknown };
          return [label, `${detailValue(key, change.before)} → ${detailValue(key, change.after)}`];
        }
        return [label, detailValue(key, value)];
      });
    };

    return { formatNumber, formatArs, formatDate, formatDateTime, statusLabel, planName, isExclusive, actionLabel, errorText, describeDetails };
  }, [t, locale]);
}

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
    return { ok: false, status: 0, data: { error: NETWORK_ERROR } as OwnerResult<T>["data"] };
  }
}

export type ListPage<T> = { items: T[]; page: number; totalPages: number; totalItems: number };

/** Paginated list with debounced search, status filter and protection against stale responses. */
export function useOwnerList<T>(endpoint: string, errorMessage: string, onUnauthorized: () => void, filterKey = "status") {
  const { errorText } = useOwnerFormat();
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
    else setError(errorText(result.data.error, errorMessage));
  }, [endpoint, errorMessage, errorText, filterKey, page, search, status]);

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
