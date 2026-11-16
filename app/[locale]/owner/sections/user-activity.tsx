"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  AtSign, Bot, Building2, ChevronDown, FileSpreadsheet, FileText, Handshake, Mail, MessageCircle, MessageSquare, Phone, Send,
  ShieldCheck, Sparkles, TriangleAlert, User, UserSearch, X, type LucideIcon,
} from "lucide-react";
import {
  errorBox, ghostButton, hintText, iconButton, isUnauthorized, mutedText, ownerFetch, smallButton, stateBox, useFocusTrap, useOwnerFormat,
} from "../ui";

// "Actividad" of one user in the owner panel: KPI strip, newest-first lists with excerpts and "Ver más", AI/Gmail usage, and
// a dialog that fetches the full content from the audited routes (each open is written to Auditoría by the server).

type Page<T> = { items: T[]; page: number; totalPages: number; totalItems: number };
type ConversationItem = { id: string; title: string; messageCount: number; lastMessageAt: string; archived: boolean };
type GeneratedItem = { id: string; key: string; leadName: string; channel: string; subject: string; excerpt: string; date: string };
type ContactItem = { id: string; leadName: string; channel: string; status: string; excerpt: string; date: string };
type ScheduledItem = { id: string; channel: string; recipient: string; leadName: string; subject: string; excerpt: string; sendAt: string; status: string; error: string };
type SearchItem = { id: string; kind: "business" | "person"; query: string; area: string; requested: number; results: number; status: string; date: string };
type Items = { conversations: ConversationItem; generated: GeneratedItem; contacts: ContactItem; scheduled: ScheduledItem; searches: SearchItem };
type Section = keyof Items;
type Activity = {
  periodDays: number;
  summary: Record<Section, number>;
  sections: { [K in Section]: Page<Items[K]> | null };
  gmail: { total: number; days: { day: string; used: number }[] } | null;
  ai: { calls: number; tokens: number; costUsd: number; truncated: boolean; byFeature: { feature: string; calls: number; tokens: number; costUsd: number }[] } | null;
  unavailable: string[];
};

type Attachment = { name: string; kind: string; rows: number | null; source: "drive" | "upload" };
type GeneratedGroup = { leadName: string; messages: { channel: string; subject: string; text: string }[] };
type Transcript = {
  title: string; archived: boolean; messageCount: number; truncated: boolean;
  messages: { role: "user" | "assistant"; content: string; redacted?: "drive"; at: number | null; attachments: Attachment[]; tools: string[]; generated: GeneratedGroup[] }[];
};
type FullMessage =
  | { kind: "contact"; leadName: string; channel: string; status: string; message: string; notes: string; date: string }
  | { kind: "scheduled"; channel: string; recipient: string; leadName: string; subject: string; body: string; sendAt: string; status: string; error: string; sentAt: string }
  | { kind: "generated"; date: string; groups: GeneratedGroup[] };
type Target = { type: "conversation"; id: string } | { type: "message"; kind: "contact" | "scheduled" | "generated"; id: string };

const sectionOrder: Section[] = ["conversations", "generated", "contacts", "scheduled", "searches"];
const messageSection = { contact: "contacts", scheduled: "scheduled", generated: "generated" } as const;

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(color:--ash-950)";
const panelClass = "grid gap-2 rounded-[10px] border border-(color:--line) bg-(--paper) p-4";
const panelTitle = "m-0 flex items-center gap-2 text-[13px] font-semibold text-(color:--ink)";
const countChip = "rounded-full bg-(--ash-150) px-1.5 py-px text-[11px] font-semibold tabular-nums text-(color:--ash-800)";
const quietButton = `inline-flex min-h-9 cursor-pointer items-center gap-1 rounded-lg border-0 bg-transparent px-2 text-xs font-semibold text-(color:--ash-800) enabled:hover:bg-(--ash-50) enabled:hover:text-(color:--ink) disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;
const metaLine = "flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-(color:--muted)";
const thinScroll = "[scrollbar-color:var(--ash-300)_transparent] [scrollbar-width:thin]";

// Semantic tone for status chips, inside the shared palette: lime = done, dark = needs attention, outline = not yet, quiet = closed.
const tones = {
  positive: ["sent", "completed", "authorized", "processed", "won", "replied", "meeting"],
  alert: ["failed", "rejected", "error"],
  pending: ["scheduled", "sending", "pending", "processing", "queued", "running"],
  closed: ["cancelled", "canceled", "lost", "archived"],
};
const chipBase = "inline-flex items-center whitespace-nowrap rounded-full border px-[7px] py-px text-[10px] font-bold leading-[14px]";
function chipClass(status: string) {
  if (tones.positive.includes(status)) return `${chipBase} border-transparent bg-(--lime) text-(color:--ink)`;
  if (tones.alert.includes(status)) return `${chipBase} border-transparent bg-(--ash-950) text-(color:--paper)`;
  if (tones.pending.includes(status)) return `${chipBase} border-(color:--ash-400) bg-(--paper) text-(color:--ash-900)`;
  if (tones.closed.includes(status)) return `${chipBase} border-transparent bg-(--ash-150) text-(color:--ash-700)`;
  return `${chipBase} border-transparent bg-(--ash-200) text-(color:--ash-900)`;
}

const channelIcons: Record<string, LucideIcon> = { whatsapp: MessageCircle, email: Mail, phone: Phone, instagram: AtSign, linkedin: AtSign, in_person: Handshake };
const channelIcon = (channel: string) => channelIcons[channel] ?? Send;

const parseDate = (value: string) => {
  if (!value) return null;
  const parsed = new Date(value.replace(" ", "T"));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

function useLabels() {
  const t = useTranslations("Owner.activity");
  const { statusLabel } = useOwnerFormat();
  return useMemo(() => ({
    channel: (value: string) => (t.has(`channels.${value}`) ? t(`channels.${value}`) : value || "—"),
    status: (value: string) => (t.has(`statuses.${value}`) ? t(`statuses.${value}`) : statusLabel(value)),
  }), [t, statusLabel]);
}

/** Locale-aware number/time helpers local to this tab (relative times, compact USD, date-only Gmail days). */
function useActivityFormat() {
  const locale = useLocale();
  return useMemo(() => {
    const tag = locale === "en" ? "en-US" : "es-AR";
    const relative = new Intl.RelativeTimeFormat(tag, { numeric: "auto", style: "short" });
    const shortDate = new Intl.DateTimeFormat(tag, { day: "numeric", month: "short" });
    const shortDateYear = new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", year: "numeric" });
    const dayFormat = new Intl.DateTimeFormat(tag, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
    const usd = new Intl.NumberFormat(tag, { style: "currency", currency: "USD", maximumFractionDigits: 4 });
    const usdWhole = new Intl.NumberFormat(tag, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
    const usdSmall = new Intl.NumberFormat(tag, { style: "currency", currency: "USD", maximumSignificantDigits: 2 });

    /** "hace 3 h" / "en 2 d" within a week of `now`, short date beyond. */
    const when = (value: string, now: number) => {
      const date = parseDate(value);
      if (!date) return null;
      const seconds = (date.getTime() - now) / 1000;
      const abs = Math.abs(seconds);
      let label: string;
      if (abs < 45) label = relative.format(0, "second");
      else if (abs < 45 * 60) label = relative.format(Math.round(seconds / 60), "minute");
      else if (abs < 22 * 3600) label = relative.format(Math.round(seconds / 3600), "hour");
      else if (abs < 7 * 86400) label = relative.format(Math.round(seconds / 86400), "day");
      else label = (date.getFullYear() === new Date(now).getFullYear() ? shortDate : shortDateYear).format(date);
      return { label, iso: date.toISOString() };
    };
    const day = (value: string) => { const date = parseDate(`${value}T00:00:00Z`); return date ? dayFormat.format(date) : value; };
    const money = (value: number) => (value === 0 ? usdWhole.format(0) : value >= 1 ? usdWhole.format(value) : usdSmall.format(value));
    return { when, day, money, usd: (value: number) => usd.format(value) };
  }, [locale]);
}

type RowProps = {
  icon: LucideIcon;
  iconLabel: string;
  primary: ReactNode;
  secondary?: ReactNode;
  excerpt?: string;
  time: { label: string; iso: string; full: string } | null;
  status?: { tone: string; label: string };
  ariaLabel?: string;
  onOpen?: (opener: HTMLElement) => void;
};

/** One list row: type icon · primary line + 1-2 line excerpt · right-aligned relative time and status chip. */
function ActivityRow({ icon: Icon, iconLabel, primary, secondary, excerpt, time, status, ariaLabel, onOpen }: RowProps) {
  const body = (
    <>
      <span className="mt-px inline-grid size-7 shrink-0 place-items-center rounded-md bg-(--ash-100) text-(color:--ash-700)">
        <Icon size={14} aria-hidden="true" />
        <span className="sr-only">{iconLabel}</span>
      </span>
      <span className="grid min-w-0 gap-0.5">
        <span className="truncate text-[13px] font-semibold leading-snug text-(color:--ink)">{primary}</span>
        {secondary && <span className="truncate text-[11px] leading-snug text-(color:--muted)">{secondary}</span>}
        {excerpt && <span className="line-clamp-2 break-words text-xs leading-snug text-(color:--ash-800)">{excerpt}</span>}
      </span>
      <span className="grid justify-items-end gap-1 text-right">
        {time ? <time className="whitespace-nowrap text-[11px] tabular-nums text-(color:--muted)" dateTime={time.iso} title={time.full}>{time.label}</time> : <span className="text-[11px] text-(color:--muted)">—</span>}
        {status && <span className={chipClass(status.tone)}>{status.label}</span>}
      </span>
    </>
  );
  const layout = "grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2.5 rounded-lg px-2 py-2.5 text-left";
  if (!onOpen) return <div className={layout}>{body}</div>;
  return (
    <button type="button" className={`${layout} cursor-pointer border-0 bg-transparent hover:bg-(--ash-50) ${focusRing}`} aria-label={ariaLabel} onClick={(event) => onOpen(event.currentTarget)}>
      {body}
    </button>
  );
}

export default function UserActivity({ userId, onUnauthorized, onDialogChange }: {
  userId: string;
  onUnauthorized: () => void;
  /** Lets the drawer pause its own focus trap / Esc handling while the content dialog is open. */
  onDialogChange?: (open: boolean) => void;
}) {
  const t = useTranslations("Owner.activity");
  const { formatNumber, formatDateTime, errorText } = useOwnerFormat();
  const { when, day, money, usd } = useActivityFormat();
  const labels = useLabels();
  const [data, setData] = useState<Activity | null>(null);
  // Reference instant for relative times, taken when the data arrives (not during render).
  const [now, setNow] = useState(0);
  const [error, setError] = useState("");
  const [more, setMore] = useState<{ section: Section | null; error: Section | null }>({ section: null, error: null });
  const [target, setTarget] = useState<Target | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const base = `/api/owner/users/${encodeURIComponent(userId)}/activity`;

  const load = useCallback(async () => {
    setError("");
    const result = await ownerFetch<Activity>(base);
    if (isUnauthorized(result.status)) return onUnauthorized();
    if (result.ok) { setNow(Date.now()); setData(result.data); }
    else setError(errorText(result.data.error, t("loadError")));
  }, [base, onUnauthorized, errorText, t]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount
  useEffect(() => { void load(); }, [load]);

  async function loadMore(section: Section) {
    const current = data?.sections[section];
    if (!current || more.section) return;
    setMore({ section, error: null });
    const result = await ownerFetch<Page<Items[Section]>>(`${base}?section=${section}&page=${current.page + 1}`);
    if (isUnauthorized(result.status)) return onUnauthorized();
    if (!result.ok) { setMore({ section: null, error: section }); return; }
    setMore({ section: null, error: null });
    setData((previous) => {
      const existing = previous?.sections[section];
      if (!previous || !existing) return previous;
      const page = { ...result.data, items: [...existing.items, ...result.data.items] };
      return { ...previous, sections: { ...previous.sections, [section]: page } };
    });
  }

  const open = (opener: HTMLElement, next: Target) => {
    openerRef.current = opener;
    setTarget(next);
    onDialogChange?.(true);
  };
  const close = useCallback(() => {
    setTarget(null);
    onDialogChange?.(false);
    window.setTimeout(() => openerRef.current?.focus(), 0);
  }, [onDialogChange]);

  if (error) {
    return (
      <div className="grid gap-2">
        <p className={`${errorBox} mb-0!`} role="alert">{error}</p>
        <div><button type="button" className={`${ghostButton} ${smallButton}`} onClick={() => void load()}>{t("retry")}</button></div>
      </div>
    );
  }
  if (!data) return <p className={stateBox} role="status">{t("loading")}</p>;

  const period = t("lastDays", { days: data.periodDays });
  const kpis: { key: string; label: string; value: string; sub?: string }[] = [
    ...sectionOrder.map((section) => ({ key: section, label: t(section), value: formatNumber(data.summary[section]) })),
    { key: "gmail", label: t("gmail"), value: data.gmail ? formatNumber(data.gmail.total) : "—", sub: period },
    { key: "aiCalls", label: t("aiCalls"), value: data.ai ? formatNumber(data.ai.calls) : "—", sub: period },
    { key: "aiCost", label: t("aiCost"), value: data.ai ? money(data.ai.costUsd) : "—", sub: period },
  ];

  const timeOf = (value: string) => { const time = when(value, now); return time && { ...time, full: formatDateTime(value) }; };

  const renderItem = (section: Section, item: Items[Section]) => {
    if (section === "conversations") {
      const row = item as ConversationItem;
      const title = row.title || t("untitled");
      return (
        <ActivityRow icon={MessageSquare} iconLabel={t("conversations")} primary={title} secondary={t("messageCount", { count: row.messageCount })}
          time={timeOf(row.lastMessageAt)} status={row.archived ? { tone: "archived", label: t("archived") } : undefined}
          ariaLabel={t("openAria", { label: title })} onOpen={(opener) => open(opener, { type: "conversation", id: row.id })} />
      );
    }
    if (section === "generated") {
      const row = item as GeneratedItem;
      const lead = row.leadName || t("noLead");
      return (
        <ActivityRow icon={Sparkles} iconLabel={labels.channel(row.channel)} primary={lead}
          secondary={[labels.channel(row.channel), row.subject].filter(Boolean).join(" · ")} excerpt={row.excerpt} time={timeOf(row.date)}
          ariaLabel={t("openAria", { label: lead })} onOpen={(opener) => open(opener, { type: "message", kind: "generated", id: row.id })} />
      );
    }
    if (section === "contacts") {
      const row = item as ContactItem;
      const lead = row.leadName || t("noLead");
      return (
        <ActivityRow icon={channelIcon(row.channel)} iconLabel={labels.channel(row.channel)} primary={lead} secondary={labels.channel(row.channel)}
          excerpt={row.excerpt} time={timeOf(row.date)} status={{ tone: row.status, label: labels.status(row.status) }}
          ariaLabel={t("openAria", { label: lead })} onOpen={(opener) => open(opener, { type: "message", kind: "contact", id: row.id })} />
      );
    }
    if (section === "scheduled") {
      const row = item as ScheduledItem;
      const label = row.leadName || row.recipient || t("noLead");
      return (
        <ActivityRow icon={channelIcon(row.channel)} iconLabel={labels.channel(row.channel)} primary={label}
          secondary={[labels.channel(row.channel), row.subject].filter(Boolean).join(" · ")}
          excerpt={row.error ? `${t("error")}: ${row.error}` : row.excerpt} time={timeOf(row.sendAt)}
          status={{ tone: row.status, label: labels.status(row.status) }}
          ariaLabel={t("openAria", { label })} onOpen={(opener) => open(opener, { type: "message", kind: "scheduled", id: row.id })} />
      );
    }
    const row = item as SearchItem;
    const kind = row.kind === "person" ? t("kindPerson") : t("kindBusiness");
    return (
      <ActivityRow icon={row.kind === "person" ? UserSearch : Building2} iconLabel={kind} primary={row.query || "—"}
        secondary={[kind, row.area, t("searchCounts", { requested: formatNumber(row.requested), results: formatNumber(row.results) })].filter(Boolean).join(" · ")}
        time={timeOf(row.date)} status={{ tone: row.status, label: labels.status(row.status) }} />
    );
  };

  const gmailMax = data.gmail ? Math.max(0, ...data.gmail.days.map((row) => row.used)) : 0;

  return (
    <div className="grid gap-3">
      {data.unavailable.length > 0 && (
        <p className={`${errorBox} mb-0!`} role="status">{t("unavailable", { sources: data.unavailable.map((source) => (t.has(source) ? t(source) : source)).join(", ") })}</p>
      )}

      <section aria-label={t("summaryLabel")}>
        <dl className="m-0 grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border border-(color:--line) bg-(--line) sm:grid-cols-4">
          {kpis.map((kpi) => (
            <div key={kpi.key} className="grid min-w-0 content-start gap-1.5 bg-(--paper) px-3 py-2.5">
              <dt className="text-[11px] leading-tight text-(color:--muted)">{kpi.label}</dt>
              <dd className="m-0 break-words text-lg font-[680] leading-none tracking-[-0.02em] tabular-nums text-(color:--ink)">{kpi.value}</dd>
              {kpi.sub && <dd className="m-0 text-[10px] leading-tight text-(color:--ash-700)">{kpi.sub}</dd>}
            </div>
          ))}
        </dl>
      </section>

      {sectionOrder.map((section) => {
        const page = data.sections[section];
        if (!page) return null;
        const headingId = `activity-${section}`;
        const hasMore = page.page < page.totalPages;
        return (
          <section key={section} className={panelClass} aria-labelledby={headingId}>
            <h3 id={headingId} className={panelTitle}>{t(section)} <span className={countChip}>{formatNumber(page.totalItems)}</span></h3>
            {page.items.length === 0 ? <p className={`m-0 ${mutedText}`}>{t("empty")}</p> : (
              <ul className="-mx-2 m-0 grid list-none divide-y divide-(--ash-150) p-0">
                {page.items.map((item) => <li key={"key" in item ? item.key : item.id}>{renderItem(section, item)}</li>)}
              </ul>
            )}
            {more.error === section && <p className={`m-0 ${hintText}`} role="alert">{t("moreError")}</p>}
            {hasMore && (
              <div className="-mb-1 flex items-center justify-between gap-2 border-t border-(color:--ash-150) pt-1.5">
                <span className={`${hintText} tabular-nums`}>{t("shownOf", { shown: formatNumber(page.items.length), total: formatNumber(page.totalItems) })}</span>
                <button type="button" className={quietButton} disabled={more.section !== null} onClick={() => void loadMore(section)}>
                  {more.section === section ? t("loadingMore") : t("more")} <ChevronDown size={14} aria-hidden="true" />
                </button>
              </div>
            )}
          </section>
        );
      })}

      <section className={panelClass} aria-labelledby="activity-ai">
        <h3 id="activity-ai" className={panelTitle}>{t("aiByFeature")} <span className="text-[11px] font-normal text-(color:--muted)">{period}</span></h3>
        {!data.ai || data.ai.byFeature.length === 0 ? <p className={`m-0 ${mutedText}`}>{t("noAi")}</p> : (
          <>
            <div className={`overflow-x-auto ${thinScroll}`}>
              <table className="w-full border-collapse text-xs tabular-nums">
                <thead>
                  <tr className="border-b border-(color:--line) text-[11px] text-(color:--muted)">
                    <th className="py-1.5 pr-2 text-left font-semibold" scope="col">{t("feature")}</th>
                    <th className="py-1.5 pl-3 text-right font-semibold" scope="col">{t("calls")}</th>
                    <th className="py-1.5 pl-3 text-right font-semibold" scope="col">{t("tokens")}</th>
                    <th className="py-1.5 pl-3 text-right font-semibold" scope="col">{t("cost")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.ai.byFeature.map((row) => (
                    <tr className="border-b border-(color:--ash-150)" key={row.feature}>
                      <th className="py-1.5 pr-2 text-left font-normal text-(color:--ink) [overflow-wrap:anywhere]" scope="row">{row.feature}</th>
                      <td className="whitespace-nowrap py-1.5 pl-3 text-right">{formatNumber(row.calls)}</td>
                      <td className="whitespace-nowrap py-1.5 pl-3 text-right">{formatNumber(row.tokens)}</td>
                      <td className="whitespace-nowrap py-1.5 pl-3 text-right">{usd(row.costUsd)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-(color:--ash-400) font-semibold text-(color:--ink)">
                    <th className="pt-2 pr-2 text-left" scope="row">{t("total")}</th>
                    <td className="whitespace-nowrap pt-2 pl-3 text-right">{formatNumber(data.ai.calls)}</td>
                    <td className="whitespace-nowrap pt-2 pl-3 text-right">{formatNumber(data.ai.tokens)}</td>
                    <td className="whitespace-nowrap pt-2 pl-3 text-right">{usd(data.ai.costUsd)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {data.ai.truncated && <p className={`m-0 ${hintText}`}>{t("aiTruncated")}</p>}
          </>
        )}
      </section>

      <section className={panelClass} aria-labelledby="activity-gmail">
        <h3 id="activity-gmail" className={panelTitle}>
          {t("gmail")} {data.gmail && <span className={countChip}>{formatNumber(data.gmail.total)}</span>}
          <span className="text-[11px] font-normal text-(color:--muted)">{period}</span>
        </h3>
        {!data.gmail || data.gmail.days.length === 0 ? <p className={`m-0 ${mutedText}`}>{t("noGmail")}</p> : (
          <ul className="m-0 grid list-none gap-1 p-0 text-[11px]">
            {data.gmail.days.map((row) => {
              const peak = row.used === gmailMax;
              return (
                <li key={row.day} className="grid grid-cols-[5.5rem_minmax(0,1fr)_4.5rem] items-center gap-2">
                  <span className="truncate text-(color:--muted)">{day(row.day)}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-(--ash-150)" aria-hidden="true">
                    <span className={`block h-full rounded-full ${peak ? "bg-(--lime-dark)" : "bg-(--ash-500)"}`} style={{ width: `${Math.max(4, (row.used / gmailMax) * 100)}%` }} />
                  </span>
                  <span className={`flex items-center justify-end gap-1 whitespace-nowrap tabular-nums ${peak ? "font-semibold text-(color:--ink)" : "text-(color:--ash-800)"}`}>
                    {t("gmailDay", { count: row.used })}
                    {peak && <span className="sr-only">({t("gmailPeak")})</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {target && <ContentDialog userId={userId} target={target} onClose={close} onUnauthorized={onUnauthorized} />}
    </div>
  );
}

const scrollKeys: Record<string, number> = { ArrowDown: 48, ArrowUp: -48, PageDown: 0.85, PageUp: -0.85 };

function ContentDialog({ userId, target, onClose, onUnauthorized }: { userId: string; target: Target; onClose: () => void; onUnauthorized: () => void }) {
  const t = useTranslations("Owner.activity");
  const common = useTranslations("Owner.common");
  const { formatDateTime, formatNumber, errorText } = useOwnerFormat();
  const labels = useLabels();
  const [state, setState] = useState<{ kind: "loading" } | { kind: "error"; text: string } | { kind: "conversation"; data: Transcript } | { kind: "message"; data: FullMessage }>({ kind: "loading" });
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, true, onClose);
  useEffect(() => { closeRef.current?.focus(); }, []);

  useEffect(() => {
    let cancelled = false;
    const user = encodeURIComponent(userId);
    const path = target.type === "conversation"
      ? `/api/owner/users/${user}/conversations/${encodeURIComponent(target.id)}`
      : `/api/owner/users/${user}/messages/${target.kind}/${encodeURIComponent(target.id)}`;
    void ownerFetch<Transcript & FullMessage>(path).then((result) => {
      if (cancelled) return;
      if (isUnauthorized(result.status)) return onUnauthorized();
      if (result.ok) setState(target.type === "conversation" ? { kind: "conversation", data: result.data } : { kind: "message", data: result.data });
      else setState({ kind: "error", text: result.status === 404 ? t("notFound") : result.status === 503 ? t("auditFailed") : errorText(result.data.error, t("contentError")) });
    });
    return () => { cancelled = true; };
  }, [userId, target, onUnauthorized, errorText, t]);

  // Focus stays on the close button (the trap only cycles real controls), so arrows/PageUp/PageDown scroll the content.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const body = bodyRef.current;
    const step = scrollKeys[event.key];
    if (!body || step === undefined) return;
    event.preventDefault();
    body.scrollBy({ top: Math.abs(step) < 1 ? step * body.clientHeight : step });
  };

  const message = state.kind === "message" ? state.data : null;
  const title = state.kind === "conversation" ? (state.data.title || t("untitled"))
    : message?.kind === "generated" ? (message.groups[0]?.leadName || t("dialogMessage"))
    : message ? (message.leadName || (message.kind === "scheduled" ? message.recipient : "") || t("dialogMessage"))
    : target.type === "conversation" ? t("dialogConversation") : t("dialogMessage");
  const subtitle = state.kind === "conversation"
    ? [t("messageCount", { count: state.data.messageCount }), state.data.archived ? t("archived") : ""].filter(Boolean).join(" · ")
    : target.type === "message" ? t(messageSection[target.kind]) : t("dialogConversation");

  const field = (label: string, value: ReactNode) => (value ? <div className="grid min-w-0 gap-0.5"><dt className="text-[11px] text-(color:--muted)">{label}</dt><dd className="m-0 break-words text-[13px] text-(color:--ink)">{value}</dd></div> : null);
  const bodyText = (label: string, text: string) => (
    <section className="grid gap-1">
      <h3 className="m-0 text-[11px] font-semibold text-(color:--muted)">{label}</h3>
      <p className="m-0 max-w-[68ch] whitespace-pre-wrap break-words rounded-lg border border-(color:--line) bg-(--paper) px-3.5 py-3 text-[13px] leading-relaxed text-(color:--ink)">{text}</p>
    </section>
  );
  const chip = (status: string) => <span className={chipClass(status)}>{labels.status(status)}</span>;
  const groups = (list: GeneratedGroup[]) => list.map((group, groupIndex) => (
    <div key={groupIndex} className="grid gap-1.5">
      <p className="m-0 text-xs font-semibold text-(color:--ink)">{t("suggestionsFor", { lead: group.leadName || t("noLead") })}</p>
      {group.messages.map((item, index) => {
        const Icon = channelIcon(item.channel);
        return (
          <div key={index} className="grid gap-1 rounded-lg border border-(color:--line) bg-(--paper) p-2.5">
            <span className={metaLine}>
              <Icon size={12} aria-hidden="true" /> {labels.channel(item.channel)}
              {item.subject && <><span aria-hidden="true">·</span><strong className="font-semibold text-(color:--ink)">{item.subject}</strong></>}
            </span>
            <p className="m-0 whitespace-pre-wrap break-words text-[13px] leading-normal text-(color:--ink)">{item.text || t("noContent")}</p>
          </div>
        );
      })}
    </div>
  ));

  return (
    <div className="fixed inset-0 z-60 flex items-end justify-center bg-(--ash-950)/45 sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} onKeyDown={onKeyDown} className="grid max-h-[92dvh] w-full grid-rows-[auto_auto_minmax(0,1fr)] gap-3 overflow-hidden rounded-t-[14px] border border-(color:--line) bg-(--ash-100) p-4 sm:max-w-170 sm:rounded-[14px] sm:p-5" role="dialog" aria-modal="true" aria-labelledby="activity-dialog-title" aria-describedby="activity-dialog-audit">
        <header className="flex items-start justify-between gap-3">
          <div className="grid min-w-0 gap-0.5">
            <h2 id="activity-dialog-title" className="m-0 break-words text-[17px] font-semibold leading-tight tracking-tight text-(color:--ink)">{title}</h2>
            <p className={`m-0 ${mutedText}`}>{subtitle}</p>
          </div>
          <button ref={closeRef} className={iconButton} type="button" onClick={onClose} aria-label={common("close")}><X size={18} aria-hidden="true" /></button>
        </header>
        <p id="activity-dialog-audit" className="m-0 flex items-start gap-2 rounded-lg border border-(color:--ash-200) bg-(--ash-50) px-3 py-2 text-[11px] leading-snug text-(color:--ash-800)">
          <ShieldCheck size={14} aria-hidden="true" className="mt-px shrink-0 text-(color:--ash-700)" /> {t("auditNote")}
        </p>
        <div ref={bodyRef} className={`-mx-1 min-h-0 overflow-y-auto overscroll-contain px-1 ${thinScroll}`} aria-busy={state.kind === "loading"}>
          {state.kind === "loading" && <p className={stateBox} role="status">{t("contentLoading")}</p>}
          {state.kind === "error" && <p className={`${errorBox} mb-0!`} role="alert">{state.text}</p>}

          {state.kind === "conversation" && (
            <div className="grid gap-2.5">
              {state.data.truncated && <p className={`m-0 ${hintText}`}>{t("transcriptTruncated", { count: formatNumber(state.data.messageCount) })}</p>}
              {state.data.messages.some((item) => item.attachments.length > 0) && <p className={`m-0 ${hintText}`}>{t("attachmentsHidden")}</p>}
              {state.data.messages.length === 0 && <p className={`m-0 ${mutedText}`}>{t("noMessages")}</p>}
              <ol className="m-0 grid list-none gap-2.5 p-0">
                {state.data.messages.map((item, index) => {
                  const mine = item.role === "user";
                  return (
                    <li key={index} className={`grid w-fit min-w-0 max-w-[88%] gap-1.5 rounded-xl border px-3 py-2.5 ${mine ? "justify-self-end rounded-br-sm border-(color:--ash-300) bg-(--ash-150)" : "justify-self-start rounded-bl-sm border-(color:--line) bg-(--paper)"}`}>
                      <span className="flex items-center gap-1.5 text-[11px] text-(color:--ash-700)">
                        {mine ? <User size={12} aria-hidden="true" /> : <Bot size={12} aria-hidden="true" />}
                        <strong className="font-semibold text-(color:--ink)">{mine ? t("roleUser") : t("roleAssistant")}</strong>
                        {item.at !== null && <time className="ml-auto whitespace-nowrap pl-3 tabular-nums" dateTime={new Date(item.at).toISOString()}>{formatDateTime(new Date(item.at).toISOString())}</time>}
                      </span>
                      {item.redacted === "drive"
                        ? <p className="m-0 text-xs italic text-(color:--ash-700)">{t("redactedDrive")}</p>
                        : item.content && <p className="m-0 whitespace-pre-wrap break-words text-[13px] leading-normal text-(color:--ink)">{item.content}</p>}
                      {item.attachments.length > 0 && (
                        <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label={t("attachmentsLabel")}>
                          {item.attachments.map((attachment, attachmentIndex) => {
                            const Icon = /^(csv|xlsx?|sheet|spreadsheet)$/i.test(attachment.kind) ? FileSpreadsheet : FileText;
                            return (
                              <li key={attachmentIndex} className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border border-(color:--line) bg-(--paper) px-2 py-0.5 text-[11px] text-(color:--ash-800)">
                                <Icon size={11} aria-hidden="true" className="shrink-0" />
                                <span className="min-w-0 max-w-50 truncate">{attachment.name}</span>
                                <span className="shrink-0 text-(color:--muted)">· {attachment.kind.toUpperCase()}{attachment.rows !== null && ` · ${t("attachmentRows", { rows: formatNumber(attachment.rows) })}`}{attachment.source === "drive" && ` · ${t("fromDrive")}`}</span>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      {item.generated.length > 0 && groups(item.generated)}
                      {item.tools.length > 0 && <p className="m-0 text-[11px] text-(color:--ash-700)">{t("tools", { tools: item.tools.join(", ") })}</p>}
                    </li>
                  );
                })}
              </ol>
            </div>
          )}

          {message?.kind === "contact" && (
            <div className="grid gap-3">
              <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-lg border border-(color:--line) bg-(--paper) p-3">
                {field(t("lead"), message.leadName || t("noLead"))}
                {field(t("channel"), labels.channel(message.channel))}
                {field(common("status"), chip(message.status))}
                {field(common("date"), formatDateTime(message.date))}
              </dl>
              {bodyText(t("message"), message.message || t("noContent"))}
              {message.notes && bodyText(t("notes"), message.notes)}
            </div>
          )}
          {message?.kind === "scheduled" && (
            <div className="grid gap-3">
              {message.error && (
                <p className={`${errorBox} mb-0! flex items-start gap-2`} role="status">
                  <TriangleAlert size={14} aria-hidden="true" className="mt-px shrink-0" /><span><strong className="font-semibold">{t("error")}:</strong> {message.error}</span>
                </p>
              )}
              <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-lg border border-(color:--line) bg-(--paper) p-3">
                {field(t("lead"), message.leadName)}
                {field(t("recipient"), message.recipient && <span className="break-all">{message.recipient}</span>)}
                {field(t("channel"), labels.channel(message.channel))}
                {field(common("status"), chip(message.status))}
                {field(t("sendAt"), formatDateTime(message.sendAt))}
                {message.sentAt && field(t("sentAt"), formatDateTime(message.sentAt))}
                {message.subject && <div className="col-span-2">{field(t("subject"), message.subject)}</div>}
              </dl>
              {bodyText(t("message"), message.body || t("noContent"))}
            </div>
          )}
          {message?.kind === "generated" && (
            <div className="grid gap-3">
              <p className={`m-0 ${mutedText}`}>{formatDateTime(message.date)}</p>
              {groups(message.groups)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
