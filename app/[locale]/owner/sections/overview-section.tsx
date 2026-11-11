"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  cardClass, errorBox, ghostButton, isUnauthorized, mutedText, ownerFetch, sectionHead, stateBox, useOwnerFormat,
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
  const t = useTranslations("Owner.overview");
  const common = useTranslations("Owner.common");
  const { formatArs, formatNumber, formatDateTime, planName, actionLabel, errorText } = useOwnerFormat();
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
    else setError(errorText(summary.data.error, t("loadError")));
    if (recent.ok) { setActivity(recent.data.items); setActivityError(""); }
    else { setActivity(null); setActivityError(errorText(recent.data.error, t("activityError"))); }
  }, [onUnauthorized, errorText, t]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount; state set after await
  useEffect(() => { void load(); }, [load]);

  const cards: [string, string][] = overview ? [
    [t("mrr"), formatArs(overview.mrrArs)],
    [t("activeSubscriptions"), formatNumber(overview.activeSubscriptions)],
    [t("pausedSubscriptions"), formatNumber(overview.pausedSubscriptions)],
    [t("totalUsers"), formatNumber(overview.totalUsers)],
    [t("newUsers"), formatNumber(overview.newUsers30d)],
    [t("creditsInCirculation"), formatNumber(overview.creditsInCirculation)],
    [t("revenue"), formatArs(overview.revenue30dArs)],
  ] : [];

  return (
    <section aria-label={t("title")}>
      <div className={sectionHead}>
        <h1 className="m-0 text-xl font-semibold tracking-tight">{t("title")}</h1>
        <button className={ghostButton} type="button" onClick={() => void load()}><RefreshCw size={15} aria-hidden="true" /> {common("refresh")}</button>
      </div>
      {error && <p className={errorBox} role="alert">{error}</p>}
      {!overview && !error && <p className={stateBox} role="status">{t("loading")}</p>}
      {overview && (
        <>
          <dl className="m-0 grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
            {cards.map(([label, value]) => (
              <div className={cardClass} key={label}><dt className="text-[11px] font-semibold text-(color:--muted)">{label}</dt><dd className="m-0 mt-1.5 text-[26px] font-semibold tracking-tight tabular-nums">{value}</dd></div>
            ))}
          </dl>
          <div className={`${cardClass} mt-3.5`}>
            <h2 className="m-0 mb-2.5 text-[13px] font-semibold">{t("byPlan")}</h2>
            {overview.planBreakdown.length === 0 ? <p className={mutedText}>{t("noPlans")}</p> : (
              <ul className="m-0 grid list-none gap-2 p-0">
                {overview.planBreakdown.map((row) => (
                  <li className="grid gap-0.5 border-t border-(color:--ash-150) pt-2 text-[13px] first:border-t-0 first:pt-0 md:grid-cols-[1fr_auto_auto] md:gap-4" key={row.planId}>
                    <strong>{planName(row.planId)}</strong>
                    <span className="text-(color:--muted) tabular-nums">{t("subscriptionCount", { count: row.count })}</span>
                    <span className="text-(color:--muted) tabular-nums">{common("perMonth", { value: formatArs(row.mrrArs) })}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      <div className={`${cardClass} mt-3.5`}>
        <div className="mb-2.5 flex items-center justify-between gap-3">
          <h2 className="m-0 text-[13px] font-semibold">{t("recent")}</h2>
          <button className="cursor-pointer rounded border-0 bg-transparent p-1 text-xs font-semibold text-(color:--ink) underline underline-offset-[3px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(color:--ash-950)" type="button" onClick={onOpenAudit}>{t("viewAudit")}</button>
        </div>
        {activityError && <p className={mutedText} role="status">{activityError}</p>}
        {activity && activity.length === 0 && <p className={mutedText}>{t("noActivity")}</p>}
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
