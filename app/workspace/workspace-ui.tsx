"use client";

import { useCallback, type ComponentProps, type ComponentType, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { CircleAlert, Loader2, type LucideProps } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { LeadSuiteSidebar } from "@/app/[locale]/lead-suite/lead-suite-sidebar";

// Piezas compartidas de "Mis negocios / Mis campañas / Mis propuestas" (contrato: lib/workspace/types.ts).
export const CARD = "rounded-xl border border-(color:--line) bg-(--paper) p-5 sm:p-6";
export const LABEL = "text-[11px] font-semibold tracking-[0.08em] text-(color:--muted) uppercase";
export const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(color:--ink)";
export const PRIMARY_BUTTON = `inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-(--lime) px-5 text-sm font-semibold text-(color:--ink) hover:bg-(--lime-dark) disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS}`;
export const SECONDARY_BUTTON = `inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-(color:--line) bg-(--paper) px-4 text-sm font-semibold text-(color:--ink) hover:bg-(--ash-50) disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS}`;

export type ApiResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: string };

/** fetch JSON sin cache. error: el código del contrato ({error}) o "network". */
export async function requestJson<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      ...init,
      headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, status: response.status, error: typeof payload?.error === "string" ? payload.error : "" };
    return { ok: true, status: response.status, data: payload as T };
  } catch {
    return { ok: false, status: 0, error: "network" };
  }
}

const ERROR_CODES = new Set([
  "network", "unauthorized", "not_found", "insufficient_credits", "credit_busy", "invalid_request", "rate_limited",
  "needs_whatsapp", "needs_gmail", "recipient_missing", "limit_reached", "already_sent", "send_failed",
]);

/** Código del contrato → texto traducido. Un texto ya legible del servidor (p. ej. el de créditos de /api/search) se muestra tal cual. */
export function useErrorMessage() {
  const t = useTranslations("Workspace.errors");
  return useCallback((error: string, status = 0, fallback?: string) => {
    if (ERROR_CODES.has(error)) return t(error);
    if (status === 401) return t("unauthorized");
    if (error && !/^[a-z0-9_]+$/.test(error)) return error;
    if (status === 402) return t("insufficient_credits");
    if (status === 404) return t("not_found");
    if (status === 409) return t("credit_busy");
    if (status === 429) return t("rate_limited");
    return fallback ?? t("generic");
  }, [t]);
}

export function WorkspaceShell({ active, children }: { active: ComponentProps<typeof LeadSuiteSidebar>["active"]; children: ReactNode }) {
  return (
    <div className="app-shell">
      <LeadSuiteSidebar active={active} />
      <main className="mx-auto w-full max-w-6xl px-4 pt-6 pb-16 text-(color:--ink) sm:px-6 lg:px-10 lg:pt-10">{children}</main>
    </div>
  );
}

export function PageHeader({ id, title, intro, count, children }: { id: string; title: string; intro: string; count?: string; children?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 max-w-2xl">
        <h1 id={id} className="text-2xl font-bold tracking-tight sm:text-3xl">{title}<span className="text-(color:--lime-dark)" aria-hidden="true">.</span></h1>
        <p className="mt-1.5 text-sm text-(color:--muted) sm:text-[15px]">{intro}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {count ? <span className="rounded-full border border-(color:--line) bg-(--paper) px-3 py-1 text-xs font-semibold text-(color:--ash-700)">{count}</span> : null}
        {children}
      </div>
    </header>
  );
}

export function LoadingState({ label }: { label: string }) {
  return (
    <p role="status" className="flex items-center gap-2 py-6 text-sm text-(color:--muted)">
      <Loader2 size={16} className="animate-spin text-(color:--ink) motion-reduce:animate-none" aria-hidden="true" />{label}
    </p>
  );
}

export function ErrorBanner({ message, onRetry, children }: { message: string; onRetry?: () => void; children?: ReactNode }) {
  const t = useTranslations("Workspace");
  return (
    <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-[#f1c7c2] bg-[#fff6f5] px-4 py-3 text-sm text-[#8a1c12]">
      <CircleAlert size={17} aria-hidden="true" className="shrink-0" />
      <span className="min-w-0 flex-1">{message}</span>
      {children}
      {onRetry ? <button type="button" onClick={onRetry} className={`rounded-md px-2 py-1 font-semibold underline underline-offset-2 ${FOCUS}`}>{t("retry")}</button> : null}
    </div>
  );
}

export function EmptyState({ Icon, title, text, cta }: { Icon: ComponentType<LucideProps>; title: string; text: string; cta?: { href: string; label: string; Icon?: ComponentType<LucideProps> } }) {
  const CtaIcon = cta?.Icon;
  return (
    <div className={`${CARD} flex flex-col items-center py-10 text-center`}>
      <span className="mb-3 grid size-11 place-items-center rounded-full bg-(--lime) text-(color:--ink)" aria-hidden="true"><Icon size={20} /></span>
      <h2 className="text-lg font-bold tracking-tight">{title}</h2>
      <p className="mt-1 max-w-md text-sm text-(color:--muted)">{text}</p>
      {cta ? <Link href={cta.href} className={`${PRIMARY_BUTTON} mt-5`}>{CtaIcon ? <CtaIcon size={16} aria-hidden="true" /> : null}{cta.label}</Link> : null}
    </div>
  );
}

/** Chip de filtro activo con link para quitarlo. */
export function FilterChip({ label, clearHref }: { label: string; clearHref: string }) {
  const t = useTranslations("Workspace");
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-(--ash-950) py-1 pr-1 pl-3 text-xs font-semibold text-(color:--paper)">
      <span className="max-w-56 truncate">{label}</span>
      <Link href={clearHref} className={`rounded-full bg-(--ash-800) px-2 py-0.5 text-(color:--ash-200) hover:text-(color:--paper) ${FOCUS}`}>{t("clearFilter")}</Link>
    </span>
  );
}
