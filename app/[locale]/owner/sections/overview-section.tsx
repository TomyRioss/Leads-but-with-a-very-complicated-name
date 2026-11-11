"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  actionLabel, cardClass, errorBox, formatArs, formatDateTime, formatNumber, ghostButton, isUnauthorized, mutedText,
  ownerFetch, planName, sectionHead, stateBox,
} from "../ui";

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
type Activity = { id: string; actorEmail: string; action: string; targetLabel: string; created: string };

export default function OverviewSection({ onUnauthorized, onOpenAudit }: { onUnauthorized: () => void; onOpenAudit: () => void }) {
  const t = useTranslations("UI");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [activity, setActivity] = useState<Activity[] | null>(null);
  const [activityError, setActivityError] = useState("");
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    const [summary, recent] = await Promise.all([
      ownerFetch<Overview>("/api/owner/overview"),
      ownerFetch<{ items: Activity[] }>("/api/owner/audit?perPage=8"),
    ]);
    if (id !== requestId.current) return;
    if (isUnauthorized(summary.status) || isUnauthorized(recent.status)) return onUnauthorized();
    if (summary.ok) { setOverview(summary.data); setError(""); }
    else setError(summary.data.error || "No se pudieron cargar las métricas.");
    if (recent.ok) { setActivity(recent.data.items); setActivityError(""); }
    else { setActivity(null); setActivityError(recent.data.error || "No se pudo cargar la actividad reciente."); }
  }, [onUnauthorized]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount; state set after await
  useEffect(() => { void load(); }, [load]);

  const cards: [string, string][] = overview ? [
    ["MRR", formatArs(overview.mrrArs)],
    ["Suscripciones activas", formatNumber(overview.activeSubscriptions)],
    ["Suscripciones pausadas", formatNumber(overview.pausedSubscriptions)],
    ["Usuarios totales", formatNumber(overview.totalUsers)],
    ["Nuevos (30 días)", formatNumber(overview.newUsers30d)],
    ["Créditos en circulación", formatNumber(overview.creditsInCirculation)],
    ["Ingresos (30 días)", formatArs(overview.revenue30dArs)],
  ] : [];

  return (
    <section aria-label="Resumen">
      <div className={sectionHead}>
        <h1 className="m-0 text-xl font-semibold tracking-tight">{t("t_35414e5322")}</h1>
        <button className={ghostButton} type="button" onClick={() => void load()}><RefreshCw size={15} aria-hidden="true" /> {t("t_c725f8bffa")}</button>
      </div>
      {error && <p className={errorBox} role="alert">{error}</p>}
      {!overview && !error && <p className={stateBox} role="status">{t("t_b40d98ed0d")}</p>}
      {overview && (
        <>
          <dl className="m-0 grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
            {cards.map(([label, value]) => (
              <div className={cardClass} key={label}><dt className="text-[11px] font-semibold text-(color:--muted)">{label}</dt><dd className="m-0 mt-1.5 text-[26px] font-semibold tracking-tight tabular-nums">{value}</dd></div>
            ))}
          </dl>
          <div className={`${cardClass} mt-3.5`}>
            <h2 className="m-0 mb-2.5 text-[13px] font-semibold">{t("t_fac36399e0")}</h2>
            {overview.planBreakdown.length === 0 ? <p className={mutedText}>{t("t_20b1f5ce81")}</p> : (
              <ul className="m-0 grid list-none gap-2 p-0">
                {overview.planBreakdown.map((row) => (
                  <li className="grid gap-0.5 border-t border-(color:--ash-150) pt-2 text-[13px] first:border-t-0 first:pt-0 md:grid-cols-[1fr_auto_auto] md:gap-4" key={row.planId}>
                    <strong>{planName(row.planId)}</strong>
                    <span className="text-(color:--muted) tabular-nums">{formatNumber(row.count)} {row.count === 1 ? "suscripción" : "suscripciones"}</span>
                    <span className="text-(color:--muted) tabular-nums">{formatArs(row.mrrArs)} {t("t_6d6276349c")}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      <div className={`${cardClass} mt-3.5`}>
        <div className="mb-2.5 flex items-center justify-between gap-3">
          <h2 className="m-0 text-[13px] font-semibold">{t("t_c2476fc237")}</h2>
          <button className="cursor-pointer rounded border-0 bg-transparent p-1 text-xs font-semibold text-(color:--ink) underline underline-offset-[3px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(color:--ash-950)" type="button" onClick={onOpenAudit}>{t("t_357b9b17e0")}</button>
        </div>
        {activityError && <p className={mutedText} role="status">{activityError}</p>}
        {activity && activity.length === 0 && <p className={mutedText}>{t("t_28e65bd739")}</p>}
        {activity && activity.length > 0 && (
          <ul className="m-0 grid list-none gap-2 p-0">
            {activity.map((entry) => (
              <li className="grid gap-0.5 border-t border-(color:--ash-150) pt-2 text-[13px] first:border-t-0 first:pt-0 md:grid-cols-[170px_1fr_auto] md:gap-4" key={entry.id}>
                <strong>{actionLabel(entry.action)}</strong>
                <span className="break-all text-(color:--muted)">{entry.targetLabel || "—"}</span>
                <span className="text-xs text-(color:--muted) tabular-nums">{formatDateTime(entry.created)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
