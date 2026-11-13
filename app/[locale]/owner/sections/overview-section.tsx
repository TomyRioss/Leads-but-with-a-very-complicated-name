"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  cardClass, errorBox, ghostButton, isUnauthorized, mutedText, ownerFetch, sectionHead, stateBox, useOwnerFormat,
} from "../ui";
import { DetailDialog } from "./overview-detail-dialog";

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
type Activity = { id: string; actorEmail: string; action: string; targetLabel: string; created: string; targetType?: string; targetId?: string; details?: unknown; ip?: string };
type GeneralEvent = { id: string; type: "signup" | "verified" | "leads"; email: string; count: number; date: string; details: Record<string, string | number> };
type Selected = { title: string; subtitle: string; rows: [string, string][] };

const rowButton = "grid w-full cursor-pointer gap-0.5 rounded border-0 bg-transparent p-0 text-left text-[13px] text-(color:--ink) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(color:--ash-950) hover:bg-(--ash-50)";

export default function OverviewSection({ onUnauthorized, onOpenAudit }: { onUnauthorized: () => void; onOpenAudit: () => void }) {
  const t = useTranslations("Owner.overview");
  const common = useTranslations("Owner.common");
  const { formatArs, formatNumber, formatDateTime, planName, actionLabel, errorText, describeDetails } = useOwnerFormat();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [activity, setActivity] = useState<Activity[] | null>(null);
  const [activityError, setActivityError] = useState("");
  const [events, setEvents] = useState<GeneralEvent[] | null>(null);
  const [eventsError, setEventsError] = useState("");
  const [selected, setSelected] = useState<Selected | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const requestId = useRef(0);

  const closeDetail = useCallback(() => {
    setSelected(null);
    window.setTimeout(() => openerRef.current?.focus(), 0);
  }, []);
  const openDetail = (opener: HTMLElement, next: Selected) => {
    openerRef.current = opener;
    setSelected(next);
  };
  const eventText = (event: GeneralEvent) => {
    const who = event.email || t("unknownUser");
    return event.type === "leads" ? t("eventLeads", { email: who, count: event.count }) : t(event.type === "signup" ? "eventSignup" : "eventVerified", { email: who });
  };

  const load = useCallback(async () => {
    const id = ++requestId.current;
    const [summary, recent, general] = await Promise.all([
      ownerFetch<Overview>("/api/owner/overview"),
      ownerFetch<{ items: Activity[] }>("/api/owner/audit?perPage=8"),
      ownerFetch<{ items: GeneralEvent[] }>("/api/owner/events"),
    ]);
    if (id !== requestId.current) return;
    if (isUnauthorized(summary.status) || isUnauthorized(recent.status) || isUnauthorized(general.status)) return onUnauthorized();
    if (general.ok) { setEvents(general.data.items); setEventsError(""); }
    else { setEvents(null); setEventsError(errorText(general.data.error, t("eventsError"))); }
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

      <div className="mt-3.5 grid gap-3.5 md:grid-cols-2">
        <div className={cardClass}>
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <h2 className="m-0 text-[13px] font-semibold">{t("recent")}</h2>
            <button className="cursor-pointer rounded border-0 bg-transparent p-1 text-xs font-semibold text-(color:--ink) underline underline-offset-[3px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(color:--ash-950)" type="button" onClick={onOpenAudit}>{t("viewAudit")}</button>
          </div>
          {activityError && <p className={mutedText} role="status">{activityError}</p>}
          {activity && activity.length === 0 && <p className={mutedText}>{t("noActivity")}</p>}
          {activity && activity.length > 0 && (
            <ul className="m-0 grid list-none gap-2 p-0">
              {activity.map((entry) => (
                <li className="border-t border-(color:--ash-150) pt-2 first:border-t-0 first:pt-0" key={entry.id}>
                  <button
                    type="button"
                    className={`${rowButton} md:grid-cols-[1fr_auto] md:gap-3`}
                    onClick={(event) => openDetail(event.currentTarget, {
                      title: actionLabel(entry.action),
                      subtitle: formatDateTime(entry.created),
                      rows: [
                        [t("detailActor"), entry.actorEmail || "—"],
                        [t("detailTarget"), entry.targetLabel || "—"],
                        [t("detailTargetType"), entry.targetType || "—"],
                        [t("detailTargetId"), entry.targetId || "—"],
                        [t("detailIp"), entry.ip || "—"],
                        ...describeDetails(entry.details),
                      ],
                    })}
                  >
                    <span><strong>{actionLabel(entry.action)}</strong> <span className="break-all text-(color:--muted)">{entry.targetLabel || "—"}</span></span>
                    <span className="text-xs text-(color:--muted) tabular-nums">{formatDateTime(entry.created)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className={cardClass}>
          <h2 className="m-0 mb-2.5 text-[13px] font-semibold">{t("events")}</h2>
          {eventsError && <p className={mutedText} role="status">{eventsError}</p>}
          {events && events.length === 0 && <p className={mutedText}>{t("noEvents")}</p>}
          {events && events.length > 0 && (
            <ul className="m-0 grid list-none gap-2 p-0">
              {events.map((event) => (
                <li className="border-t border-(color:--ash-150) pt-2 first:border-t-0 first:pt-0" key={event.id}>
                  <button
                    type="button"
                    className={`${rowButton} md:grid-cols-[1fr_auto] md:gap-3`}
                    onClick={(click) => openDetail(click.currentTarget, {
                      title: eventText(event),
                      subtitle: formatDateTime(event.date),
                      rows: [[t("detailDate"), formatDateTime(event.date)], ...describeDetails(event.details)],
                    })}
                  >
                    <span className="break-words">{eventText(event)}</span>
                    <span className="text-xs text-(color:--muted) tabular-nums">{formatDateTime(event.date)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {selected && <DetailDialog title={selected.title} subtitle={selected.subtitle} rows={selected.rows} closeLabel={common("close")} onClose={closeDetail} />}
    </section>
  );
}
