"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, Building2, CalendarClock, LoaderCircle, MailCheck, MessageSquare, RefreshCw, Send, Sparkles, UserPlus, Users, type LucideIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  cardClass, errorBox, ghostButton, isUnauthorized, mutedText, ownerFetch, sectionHead, sectionTitle, smallButton, stateBox, titleDot, useOwnerFormat, type OwnerResult,
} from "../ui";
import { DetailDialog, type DetailChip, type DetailExcerpt } from "./overview-detail-dialog";

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
const eventTypes = ["signup", "verified", "leads", "people", "chat", "generated", "contact", "scheduled"] as const;
type EventType = (typeof eventTypes)[number];
type GeneralEvent = { id: string; type: EventType; email: string; count: number; date: string; status?: string; excerpt?: string; details: Record<string, string | number> };
type EventsResponse = { items: GeneralEvent[]; hasMore: boolean; failedSources?: string[] };
type Selected = { title: string; subtitle: string; rows: [string, string][]; chips?: DetailChip[]; excerpts?: DetailExcerpt[] };

const eventIcons: Record<EventType, LucideIcon> = {
  signup: UserPlus, verified: MailCheck, leads: Building2, people: Users, chat: MessageSquare, generated: Sparkles, contact: Send, scheduled: CalendarClock,
};
const eventKeys: Record<EventType, string> = {
  signup: "eventSignup", verified: "eventVerified", leads: "eventLeads", people: "eventPeople", chat: "eventChat", generated: "eventGenerated", contact: "eventContact", scheduled: "eventScheduled",
};
const dateDetails = new Set(["contactedAt", "sendAt", "sentAt"]);
/** Detail field shown after the bold action as its object (search, lead or user name). */
const objectKeys: Partial<Record<EventType, string>> = {
  signup: "name", verified: "name", leads: "keywords", people: "query", generated: "leadName", contact: "leadName", scheduled: "leadName",
};
/** Client-side ceiling so the feed always leaves the loading state, even if the route never answers. */
const eventsTimeoutMs = 20000;
/** Statuses that are the normal outcome of their event and add no signal as a chip. */
const quietStatuses = new Set(["completed", "contacted"]);
const positiveStatuses = new Set(["completed", "sent", "replied", "meeting", "won"]);
const endedStatuses = new Set(["cancelled", "lost"]);

const rowButton = "grid w-full cursor-pointer gap-0.5 rounded border-0 bg-transparent p-0 text-left text-[13px] text-(color:--ink) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(color:--ash-950) hover:bg-(--ash-50)";
const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(color:--ash-950)";
const chipBase = `inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold ${focusRing}`;
const chipOn = "border-(color:--ash-950) bg-(--ash-950) text-(color:--paper)";
const chipOff = "border-(color:--ash-300) bg-(--paper) text-(color:--ink) hover:bg-(--ash-50)";
const feedRow = `grid w-full cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 rounded-lg border-0 bg-transparent px-2 py-2.5 text-left text-[13px] text-(color:--ink) hover:bg-(--ash-50) ${focusRing}`;
const iconBox = (type: EventType) =>
  `mt-0.5 inline-grid size-8 shrink-0 place-items-center rounded-lg ${type === "chat" || type === "generated" ? "bg-(--lime)/45 text-(color:--ash-900)" : "bg-(--ash-100) text-(color:--ash-800)"}`;
const eventPill = (status: string) =>
  `inline-block whitespace-nowrap rounded-full px-[7px] py-0.5 text-[10px] font-bold ${
    status === "failed" ? "bg-(--ash-950) text-(color:--paper)"
      : positiveStatuses.has(status) ? "bg-(--lime) text-(color:--ink)"
      : endedStatuses.has(status) ? "bg-(--ash-150) text-(color:--ash-700)"
      : "bg-(--ash-200) text-(color:--ash-800)"
  }`;

const parseDate = (value: string) => {
  const parsed = new Date(value.replace(" ", "T"));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};
const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

function withTimeout<T>(request: Promise<OwnerResult<T>>, message: string) {
  let timer = 0;
  const timeout = new Promise<OwnerResult<T>>((resolve) => {
    timer = window.setTimeout(() => resolve({ ok: false, status: 0, data: { error: message } as OwnerResult<T>["data"] }), eventsTimeoutMs);
  });
  return Promise.race([request, timeout]).finally(() => window.clearTimeout(timer));
}

export default function OverviewSection({ onUnauthorized, onOpenAudit }: { onUnauthorized: () => void; onOpenAudit: () => void }) {
  const t = useTranslations("Owner.overview");
  const common = useTranslations("Owner.common");
  const { formatArs, formatNumber, formatDateTime, planName, actionLabel, errorText, describeDetails } = useOwnerFormat();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [activity, setActivity] = useState<Activity[] | null>(null);
  const [activityError, setActivityError] = useState("");
  const [eventsReload, setEventsReload] = useState(0);
  const [selected, setSelected] = useState<Selected | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const requestId = useRef(0);

  const closeDetail = useCallback(() => {
    setSelected(null);
    window.setTimeout(() => openerRef.current?.focus(), 0);
  }, []);
  const openDetail = useCallback((opener: HTMLElement, next: Selected) => {
    openerRef.current = opener;
    setSelected(next);
  }, []);

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
  const refresh = () => { void load(); setEventsReload((value) => value + 1); };

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
        <h1 className={sectionTitle}>{t("title")}<span className={titleDot} aria-hidden="true">.</span></h1>
        <button className={ghostButton} type="button" onClick={refresh}><RefreshCw size={15} aria-hidden="true" /> {common("refresh")}</button>
      </div>
      {error && <p className={errorBox} role="alert">{error}</p>}
      {!overview && !error && <p className={stateBox} role="status">{t("loading")}</p>}
      {overview && (
        <>
          <dl className="m-0 grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
            {cards.map(([label, value]) => (
              <div className={`${cardClass} @container`} key={label}><dt className="text-[11px] font-semibold text-(color:--muted)">{label}</dt><dd className="m-0 mt-1.5 text-[length:min(28px,14cqi)] font-[680] tracking-[-0.03em] tabular-nums [overflow-wrap:anywhere]">{value}</dd></div>
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

      {/* The feed is the densest block: it gets the wider column on xl and the full width below. */}
      <div className="mt-3.5 grid items-start gap-3.5 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className={cardClass}>
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <h2 className="m-0 text-[13px] font-semibold">{t("recent")}</h2>
            <button className="cursor-pointer rounded border-0 bg-transparent p-1 text-xs font-semibold text-(color:--ink) underline underline-offset-[3px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(color:--ash-950)" type="button" onClick={onOpenAudit}>{t("viewAudit")}</button>
          </div>
          {activityError && <p className={mutedText} role="status">{activityError}</p>}
          {activity && activity.length === 0 && <p className={mutedText}>{t("noActivity")}</p>}
          {activity && activity.length > 0 && (
            <ul className="@container m-0 grid list-none gap-2 p-0">
              {activity.map((entry) => (
                <li className="border-t border-(color:--ash-150) pt-2 first:border-t-0 first:pt-0" key={entry.id}>
                  <button
                    type="button"
                    className={`${rowButton} @lg:grid-cols-[minmax(0,1fr)_auto] @lg:gap-3`}
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

        <EventsFeed reload={eventsReload} onUnauthorized={onUnauthorized} onOpen={openDetail} />
      </div>

      {selected && <DetailDialog title={selected.title} subtitle={selected.subtitle} rows={selected.rows} chips={selected.chips} excerpts={selected.excerpts} closeLabel={common("close")} onClose={closeDetail} />}
    </section>
  );
}

/** "Eventos generales": type chips, day-grouped rows, partial-failure notice and incremental "Ver más". */
function EventsFeed({ reload, onUnauthorized, onOpen }: { reload: number; onUnauthorized: () => void; onOpen: (opener: HTMLElement, next: Selected) => void }) {
  const t = useTranslations("Owner.overview");
  const common = useTranslations("Owner.common");
  const locale = useLocale();
  const { formatNumber, formatDateTime, errorText, statusLabel } = useOwnerFormat();
  const [type, setType] = useState<EventType | "">("");
  const [events, setEvents] = useState<GeneralEvent[] | null>(null);
  const [error, setError] = useState("");
  const [failed, setFailed] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [now, setNow] = useState(0);
  const requestId = useRef(0);

  const formats = useMemo(() => {
    const tag = locale === "en" ? "en-US" : "es-AR";
    return {
      relative: new Intl.RelativeTimeFormat(tag, { numeric: "auto", style: "short" }),
      time: new Intl.DateTimeFormat(tag, { hour: "2-digit", minute: "2-digit" }),
      day: new Intl.DateTimeFormat(tag, { weekday: "long", day: "numeric", month: "long" }),
      dayWithYear: new Intl.DateTimeFormat(tag, { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
    };
  }, [locale]);

  const channelLabel = (channel: string) => (t.has(`eventChannel.${channel}`) ? t(`eventChannel.${channel}`) : channel);
  const eventStatusLabel = (status: string) => (t.has(`eventStatus.${status}`) ? t(`eventStatus.${status}`) : statusLabel(status));
  const values = (event: GeneralEvent) => ({ email: event.email || t("unknownUser"), count: event.count, channel: channelLabel(String(event.details.channel ?? "")) });
  const eventText = (event: GeneralEvent) => t(eventKeys[event.type], values(event));
  const eventDetail = (event: GeneralEvent): Selected => ({
    title: eventText(event),
    subtitle: `${t(`eventType.${event.type}`)} · ${formatDateTime(event.date)}`,
    chips: event.status ? [{ label: eventStatusLabel(event.status), status: event.status }] : undefined,
    excerpts: event.excerpt ? [{ label: t(`eventExcerpt.${event.type}`), text: event.excerpt }] : undefined,
    rows: [
      [t("detailDate"), formatDateTime(event.date)],
      ...Object.entries(event.details).map(([key, value]): [string, string] => {
        const label = t.has(`eventDetail.${key}`) ? t(`eventDetail.${key}`) : key;
        if (value === "") return [label, "—"];
        if (typeof value === "number") return [label, formatNumber(value)];
        if (dateDetails.has(key)) return [label, formatDateTime(value)];
        if (key === "channel" || key === "channels") return [label, value.split(", ").map(channelLabel).join(", ")];
        return [label, value];
      }),
    ],
  });

  const load = useCallback(async (nextType: EventType | "", nextPage: number) => {
    const id = ++requestId.current;
    if (nextPage > 1) setLoadingMore(true);
    const params = new URLSearchParams({ page: String(nextPage) });
    if (nextType) params.set("type", nextType);
    const result = await withTimeout(ownerFetch<EventsResponse>(`/api/owner/events?${params}`), t("eventsTimeout"));
    // A newer request (filter change, refresh) owns the state; it also clears `loadingMore`.
    if (id !== requestId.current) return;
    setLoadingMore(false);
    if (isUnauthorized(result.status)) return onUnauthorized();
    if (!result.ok || !Array.isArray(result.data.items)) {
      if (nextPage === 1) { setEvents(null); setFailed([]); setHasMore(false); }
      setError(errorText(result.data.error, t("eventsError")));
      return;
    }
    const failedNow = Array.isArray(result.data.failedSources) ? result.data.failedSources : [];
    setError("");
    setNow(Date.now());
    setPage(nextPage);
    setHasMore(Boolean(result.data.hasMore));
    setFailed((current) => (nextPage === 1 ? failedNow : [...new Set([...current, ...failedNow])]));
    // New events can shift page boundaries between requests: drop ids already shown.
    setEvents((current) => {
      if (nextPage === 1 || !current) return result.data.items;
      const seen = new Set(current.map((event) => event.id));
      return [...current, ...result.data.items.filter((event) => !seen.has(event.id))];
    });
  }, [onUnauthorized, errorText, t]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- first page on mount, on filter change and on the section refresh
  useEffect(() => { void load(type, 1); }, [load, type, reload]);

  const selectType = (next: EventType | "") => {
    if (next === type) return;
    setEvents(null);
    setError("");
    setFailed([]);
    setHasMore(false);
    setType(next);
  };
  const retry = () => { setError(""); void load(type, 1); };

  const relativeTime = (date: Date) => {
    const seconds = (date.getTime() - now) / 1000;
    const abs = Math.abs(seconds);
    if (abs < 45) return formats.relative.format(0, "second");
    if (abs < 3600) return formats.relative.format(Math.round(seconds / 60), "minute");
    if (abs < 86400) return formats.relative.format(Math.round(seconds / 3600), "hour");
    return formats.time.format(date); // older rows sit under a dated header
  };
  const dayLabel = (date: Date) => {
    const today = new Date(now);
    const yesterday = new Date(now);
    yesterday.setDate(today.getDate() - 1);
    if (dayKey(date) === dayKey(today)) return t("eventsToday");
    if (dayKey(date) === dayKey(yesterday)) return t("eventsYesterday");
    const text = (date.getFullYear() === today.getFullYear() ? formats.day : formats.dayWithYear).format(date);
    return text.charAt(0).toUpperCase() + text.slice(1);
  };

  const groups: { key: string; label: string; items: { event: GeneralEvent; date: Date }[] }[] = [];
  for (const event of events ?? []) {
    const date = parseDate(event.date);
    if (!date) continue;
    const key = dayKey(date);
    const last = groups[groups.length - 1];
    if (last?.key === key) last.items.push({ event, date });
    else groups.push({ key, label: dayLabel(date), items: [{ event, date }] });
  }
  const chipLabel = (value: string) => (t.has(`eventChip.${value}`) ? t(`eventChip.${value}`) : value);

  return (
    <div className={cardClass}>
      <div className="mb-3 grid gap-2.5">
        <h2 className="m-0 text-[13px] font-semibold">{t("events")}</h2>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("eventTypeFilter")}>
          {(["", ...eventTypes] as const).map((value) => {
            const Icon = value ? eventIcons[value] : null;
            const active = value === type;
            return (
              <button className={`${chipBase} ${active ? chipOn : chipOff}`} type="button" aria-pressed={active} key={value || "all"} onClick={() => selectType(value)}>
                {Icon && <Icon size={13} aria-hidden="true" />}
                {chipLabel(value || "all")}
              </button>
            );
          })}
        </div>
      </div>

      {error && !events && (
        <div className={`${errorBox} mb-0 flex flex-wrap items-center justify-between gap-2`} role="alert">
          <span>{error}</span>
          <button className={`${ghostButton} ${smallButton}`} type="button" onClick={retry}><RefreshCw size={14} aria-hidden="true" /> {common("retry")}</button>
        </div>
      )}

      {!events && !error && (
        <div role="status" aria-busy="true">
          <span className="sr-only">{common("loading")}</span>
          <ul className="m-0 grid list-none gap-1 p-0" aria-hidden="true">
            {[0, 1, 2, 3].map((index) => (
              <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 px-2 py-2.5" key={index}>
                <span className="size-8 animate-pulse rounded-lg bg-(--ash-100) motion-reduce:animate-none" />
                <span className="grid gap-1.5 pt-0.5">
                  <span className="h-3 w-3/5 animate-pulse rounded bg-(--ash-150) motion-reduce:animate-none" />
                  <span className="h-2.5 w-2/5 animate-pulse rounded bg-(--ash-100) motion-reduce:animate-none" />
                </span>
                <span className="mt-0.5 h-2.5 w-10 animate-pulse rounded bg-(--ash-100) motion-reduce:animate-none" />
              </li>
            ))}
          </ul>
        </div>
      )}

      {events && failed.length > 0 && (
        <p className="m-0 mb-2 flex items-start gap-2 rounded-lg bg-(--ash-50) px-3 py-2 text-xs leading-snug text-(color:--ash-800)" role="status">
          <AlertTriangle className="mt-px shrink-0" size={14} aria-hidden="true" />
          <span className="min-w-0">
            {t("eventsPartial", { sources: failed.map(chipLabel).join(", ") })}{" "}
            <button className={`cursor-pointer rounded border-0 bg-transparent p-0 text-xs font-semibold text-(color:--ink) underline underline-offset-[3px] ${focusRing}`} type="button" onClick={retry}>{common("retry")}</button>
          </span>
        </p>
      )}

      {events && events.length === 0 && (
        <div className="grid justify-items-start gap-2 px-2 py-6">
          <p className="m-0 text-xs text-(color:--muted)">{type ? t("eventsEmptyFiltered", { type: t(`eventType.${type}`) }) : t("noEvents")}</p>
          {type && <button className={`${ghostButton} ${smallButton}`} type="button" onClick={() => selectType("")}>{t("eventsShowAll")}</button>}
        </div>
      )}

      {groups.length > 0 && (
        <ol className="m-0 grid list-none gap-2 p-0">
          {groups.map((group) => (
            <li key={group.key}>
              <h3 className="m-0 flex items-baseline gap-1.5 px-2 pb-1 pt-1 text-[11px] font-semibold text-(color:--muted)">
                {group.label}
                <span className="font-normal tabular-nums">{formatNumber(group.items.length)}</span>
              </h3>
              <ul className="m-0 grid list-none p-0">
                {group.items.map(({ event, date }) => {
                  const Icon = eventIcons[event.type];
                  const objectKey = objectKeys[event.type];
                  const object = objectKey ? String(event.details[objectKey] ?? "") : "";
                  const chip = event.status && !quietStatuses.has(event.status) ? event.status : "";
                  return (
                    <li className="border-t border-(color:--ash-150) first:border-t-0" key={event.id}>
                      <button type="button" className={feedRow} onClick={(click) => onOpen(click.currentTarget, eventDetail(event))}>
                        <span className={iconBox(event.type)} aria-hidden="true"><Icon size={16} /></span>
                        <span className="grid min-w-0 gap-0.5">
                          <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
                            <span className="sr-only">{t(`eventType.${event.type}`)}: </span>
                            <strong className="font-semibold">{t(`eventAction.${event.type}`, values(event))}</strong>
                            {object && <span className="min-w-0 max-w-full truncate text-(color:--ash-800)">{object}</span>}
                          </span>
                          <span className="truncate text-xs text-(color:--muted)">{event.email || t("unknownUser")}</span>
                          {event.excerpt && <span className="truncate text-xs text-(color:--ash-700)">{event.excerpt}</span>}
                        </span>
                        <span className="grid justify-items-end gap-1">
                          <time className="whitespace-nowrap text-xs text-(color:--muted) tabular-nums" dateTime={date.toISOString()} title={formatDateTime(event.date)}>{relativeTime(date)}</time>
                          {chip && <span className={eventPill(chip)}>{eventStatusLabel(chip)}</span>}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ol>
      )}

      {events && error && <p className={`${mutedText} m-0 mt-2 px-2`} role="status">{error}</p>}
      {events && hasMore && (
        <button
          className={`mt-2 flex min-h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border-0 bg-(--ash-50) text-xs font-semibold text-(color:--ink) enabled:hover:bg-(--ash-100) disabled:cursor-wait ${focusRing}`}
          type="button"
          disabled={loadingMore}
          aria-busy={loadingMore}
          onClick={() => void load(type, page + 1)}
        >
          {loadingMore && <LoaderCircle className="animate-spin motion-reduce:animate-none" size={14} aria-hidden="true" />}
          {loadingMore ? t("eventsLoadingMore") : t("eventsMore")}
        </button>
      )}
    </div>
  );
}
