"use client";

import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import { useTranslations } from "next-intl";
import { Bot, Cpu, LoaderCircle, MailCheck, MessagesSquare, Paperclip, Receipt, RefreshCw, Search, Send, Store, UserSearch, Wrench, X } from "lucide-react";
import {
  controlClass, countBadge, errorBox, ghostButton, iconButton, isUnauthorized, mutedText, ownerFetch, sectionHead, sectionTitle, stateBox,
  titleDot, useFocusTrap, useOwnerFormat,
} from "../ui";
import { DetailDialog } from "./overview-detail-dialog";
import { Pager } from "./list-controls";

// Mirrors lib/server/owner-traceability.ts (kept local: that module is server-only).
const TYPES = ["conversation", "email_sent", "email_system", "batch", "people_search", "ai_usage", "payment"] as const;
type TraceType = typeof TYPES[number];
type TraceEvent = { id: string; type: TraceType; at: string; userId: string; userEmail: string; title: string; summary: string; refId: string; detail?: Record<string, string | number> };
type TracePage = { items: TraceEvent[]; page: number; totalPages: number; totalItems: number; unavailable: TraceType[] };
type CardState = "confirmed" | "rejected" | "pending" | "failed" | "expired";
type TraceCard = { token: string; kind: string; leadName: string; state: CardState; email?: { to: string; subject: string; body: string } };
type TraceMessage = { role: "user" | "assistant"; content: string; at: number | null; tools: string[]; cards: TraceCard[]; attachments: string[] };
type TraceConversation = { id: string; userEmail: string; title: string; created: string; updated: string; messages: TraceMessage[] };

type Icon = ComponentType<{ size?: number; className?: string; "aria-hidden"?: boolean }>;
const ICONS: Record<TraceType, Icon> = { conversation: MessagesSquare, email_sent: Send, email_system: MailCheck, batch: Store, people_search: UserSearch, ai_usage: Cpu, payment: Receipt };

const chipClass = (on: boolean) => `inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-xs! font-semibold! focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(color:--ash-950) ${
  on ? "border-(color:--ash-950) bg-(--ash-950) text-(color:--paper)!" : "border-(color:--ash-300) bg-(--paper) text-(color:--ash-800)! hover:bg-(--ash-50)"
}`;
const cardStatePill: Record<CardState, string> = {
  confirmed: "bg-(--lime) text-(color:--ink)",
  rejected: "bg-(--ash-150) text-(color:--ash-600)",
  pending: "bg-(--ash-200) text-(color:--ash-800)",
  failed: "bg-(--ash-950) text-(color:--paper)",
  expired: "bg-(--ash-150) text-(color:--ash-600)",
};

export default function TraceabilitySection({ onUnauthorized }: { onUnauthorized: () => void }) {
  const t = useTranslations("Owner.traceability");
  const common = useTranslations("Owner.common");
  const { formatNumber, formatArs, formatDate, formatDateTime, statusLabel, errorText } = useOwnerFormat();
  const [query, setQuery] = useState("");
  const [user, setUser] = useState("");
  const [types, setTypes] = useState<TraceType[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<TracePage | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [email, setEmail] = useState<TraceEvent | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const unauthorizedRef = useRef(onUnauthorized);
  useEffect(() => { unauthorizedRef.current = onUnauthorized; });

  useEffect(() => {
    const timer = window.setTimeout(() => { setPage(1); setUser(query.trim()); }, 350);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let current = true;
    const params = new URLSearchParams({ page: String(page) });
    if (user) params.set("user", user);
    if (types.length) params.set("types", types.join(","));
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    ownerFetch<TracePage>(`/api/owner/traceability?${params}`).then((result) => {
      if (!current) return;
      setLoading(false);
      if (isUnauthorized(result.status)) return unauthorizedRef.current();
      if (result.ok) { setData(result.data); setError(""); }
      else setError(errorText(result.data.error, t("loadError")));
    });
    return () => { current = false; };
  }, [user, types, from, to, page, reloadKey, errorText, t]);

  // Every filter change starts a new request: show the loading state from the event, not from the effect.
  const refetch = useCallback((apply: () => void) => { setLoading(true); setPage(1); apply(); }, []);
  const toggleType = (type: TraceType) => refetch(() => setTypes((current) => (current.includes(type) ? current.filter((item) => item !== type) : [...current, type])));
  const filtered = Boolean(user || types.length || from || to);

  const titleOf = (event: TraceEvent) => {
    if (event.type === "email_system") return t.has(`system.${event.title}`) ? t(`system.${event.title}`) : event.title;
    if (event.type === "conversation") return event.title || t("noTitle");
    return event.title || "—";
  };
  const summaryOf = (event: TraceEvent) => {
    const d = event.detail ?? {};
    switch (event.type) {
      case "conversation": return t("summary.messages", { count: Number(d.messages ?? 0) });
      case "email_sent": return [event.summary && t("summary.toLead", { lead: event.summary }), d.status && statusLabel(String(d.status))].filter(Boolean).join(" · ");
      case "email_system": return d.weekStart ? t("summary.week", { date: formatDate(String(d.weekStart)) }) : "";
      case "batch":
      case "people_search": return [event.summary, t("summary.results", { results: formatNumber(Number(d.results ?? 0)), requested: formatNumber(Number(d.requested ?? 0)) }), statusLabel(String(d.status ?? ""))].filter(Boolean).join(" · ");
      case "ai_usage": return [t("summary.ai", { calls: Number(d.calls ?? 0), tokens: formatNumber(Number(d.tokens ?? 0)), cost: Number(d.costUsd ?? 0).toFixed(4) }), d.models].filter(Boolean).join(" · ");
      case "payment": return [t("summary.payment", { amount: formatArs(Number(d.amountArs ?? 0)), credits: formatNumber(Number(d.credits ?? 0)) }), statusLabel(String(d.status ?? ""))].join(" · ");
    }
  };
  const openable = (event: TraceEvent) => event.type === "conversation" || event.type === "email_sent";
  const open = (event: TraceEvent) => (event.type === "conversation" ? setConversationId(event.refId) : setEmail(event));

  return (
    <section aria-label={t("title")}>
      <div className={sectionHead}>
        <div className="grid gap-1">
          <h1 className={sectionTitle}>{t("title")}<span className={titleDot} aria-hidden="true">.</span>{data && <span className={countBadge}>{formatNumber(data.totalItems)}</span>}</h1>
          <p className={`${mutedText} m-0`}>{t("intro")}</p>
        </div>
        <button className={ghostButton} type="button" onClick={() => refetch(() => setReloadKey((key) => key + 1))}><RefreshCw size={15} aria-hidden="true" /> {common("refresh")}</button>
      </div>

      <div className="mb-3.5 grid gap-3 rounded-[10px] border border-(color:--line) bg-(--paper) p-3.5">
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
          <label className="relative flex items-center">
            <Search className="pointer-events-none absolute left-3 text-(color:--ash-600)" size={15} aria-hidden="true" />
            <span className="sr-only">{t("clientLabel")}</span>
            <input className={`${controlClass} pl-[33px]`} type="search" placeholder={t("clientPlaceholder")} value={query} onChange={(event) => { setLoading(true); setQuery(event.target.value); }} />
          </label>
          <label className="grid gap-1 text-[11px] font-semibold text-(color:--muted)">{t("from")}
            <input className={`${controlClass} sm:w-40`} type="date" value={from} max={to || undefined} onChange={(event) => refetch(() => setFrom(event.target.value))} />
          </label>
          <label className="grid gap-1 text-[11px] font-semibold text-(color:--muted)">{t("to")}
            <input className={`${controlClass} sm:w-40`} type="date" value={to} min={from || undefined} onChange={(event) => refetch(() => setTo(event.target.value))} />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("typesLabel")}>
          {TYPES.map((type) => {
            const Icon = ICONS[type];
            const on = types.includes(type);
            return <button key={type} type="button" className={chipClass(on)} aria-pressed={on} onClick={() => toggleType(type)}><Icon size={14} aria-hidden={true} /> {t(`types.${type}`)}</button>;
          })}
          {filtered && <button type="button" className="min-h-9 cursor-pointer rounded border-0 bg-transparent px-2 text-xs font-semibold underline underline-offset-[3px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(color:--ash-950)" onClick={() => refetch(() => { setQuery(""); setUser(""); setTypes([]); setFrom(""); setTo(""); })}>{t("clearFilters")}</button>}
        </div>
      </div>

      {error && <p className={errorBox} role="alert">{error}</p>}
      {data && data.unavailable.length > 0 && <p className={errorBox} role="status">{t("unavailable", { types: data.unavailable.map((type) => t(`types.${type}`)).join(", ") })}</p>}

      {loading && !data && <p className={stateBox} role="status"><LoaderCircle className="animate-spin" size={16} aria-hidden="true" /> {common("loading")}</p>}
      {data && data.items.length === 0 && !loading && <p className={`${stateBox} justify-center rounded-[10px] border border-dashed border-(color:--ash-300) bg-(--paper)`}>{filtered ? t("emptyFilter") : t("empty")}</p>}

      {data && data.items.length > 0 && (
        <ol className={`m-0 grid list-none gap-0 rounded-[10px] border border-(color:--line) bg-(--paper) p-0${loading ? " opacity-60 transition-opacity" : ""}`} aria-busy={loading}>
          {data.items.map((event) => {
            const Icon = ICONS[event.type];
            const body = (
              <>
                <span className={`mt-0.5 grid size-9 shrink-0 place-items-center rounded-full ${event.type === "conversation" ? "bg-(--lime) text-(color:--ash-950)" : "bg-(--ash-150) text-(color:--ash-800)"}`}><Icon size={16} aria-hidden={true} /></span>
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-[11px] font-bold uppercase tracking-wide text-(color:--muted)">{t(`types.${event.type}`)}</span>
                    <time className="text-[11px] text-(color:--muted) tabular-nums" dateTime={event.at}>{formatDateTime(event.at)}</time>
                  </span>
                  <span className="break-words text-[13px] font-semibold text-(color:--ink)">{titleOf(event)}</span>
                  {summaryOf(event) && <span className="break-words text-xs text-(color:--ash-700)">{summaryOf(event)}</span>}
                  <span className="break-all text-[11px] text-(color:--muted)">{event.userEmail || t("noUser")}</span>
                </span>
              </>
            );
            return (
              <li key={event.id} className="border-b border-(color:--ash-150) last:border-b-0">
                {openable(event) ? (
                  <button type="button" onClick={() => open(event)} aria-label={`${t("open")}: ${titleOf(event)}`} className="flex w-full cursor-pointer items-start gap-3 border-0 bg-transparent px-3.5 py-3 text-left hover:bg-(--ash-50) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(color:--ash-950)">{body}</button>
                ) : (
                  <div className="flex items-start gap-3 px-3.5 py-3">{body}</div>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {data && <Pager page={data.page} totalPages={data.totalPages} loading={loading} onPage={(next) => { setLoading(true); setPage(next); }} />}

      {email && (
        <DetailDialog
          title={t("email.title")}
          subtitle={formatDateTime(email.at)}
          closeLabel={common("close")}
          onClose={() => setEmail(null)}
          rows={[
            [t("email.client"), email.userEmail || t("noUser")],
            [t("email.to"), String(email.detail?.to || "—")],
            [t("email.lead"), String(email.detail?.leadName || "—")],
            [t("email.status"), statusLabel(String(email.detail?.status ?? ""))],
            [t("email.subject"), String(email.detail?.subject || "—")],
            [t("email.body"), String(email.detail?.body || "—")],
          ]}
        />
      )}
      {conversationId && <ConversationDialog id={conversationId} onClose={() => setConversationId(null)} onUnauthorized={onUnauthorized} />}
    </section>
  );
}

function ConversationDialog({ id, onClose, onUnauthorized }: { id: string; onClose: () => void; onUnauthorized: () => void }) {
  const t = useTranslations("Owner.traceability.chat");
  const common = useTranslations("Owner.common");
  const { formatDateTime, errorText } = useOwnerFormat();
  const [conversation, setConversation] = useState<TraceConversation | null>(null);
  const [error, setError] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useFocusTrap(ref, true, onClose);
  useEffect(() => { closeRef.current?.focus(); }, []);

  useEffect(() => {
    let current = true;
    ownerFetch<TraceConversation>(`/api/owner/traceability/conversations/${encodeURIComponent(id)}`).then((result) => {
      if (!current) return;
      if (isUnauthorized(result.status)) return onUnauthorized();
      if (result.ok) setConversation(result.data);
      else setError(result.status === 404 ? t("notFound") : errorText(result.data.error, t("loadError")));
    });
    return () => { current = false; };
  }, [id, onUnauthorized, errorText, t]);

  const kindLabel = (kind: string) => (t.has(`kinds.${kind}`) ? t(`kinds.${kind}`) : kind);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-(--ash-950)/45 p-4 max-sm:p-2" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={conversation?.title || t("title")} className="grid max-h-[calc(100dvh-32px)] w-full max-w-2xl grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-[10px] border border-(color:--line) bg-(--paper)">
        <header className="flex items-start justify-between gap-3 border-b border-(color:--line) p-4">
          <div className="min-w-0">
            <h2 className="m-0 break-words text-[17px] font-semibold tracking-tight">{conversation?.title || t("title")}</h2>
            {conversation && <p className="m-0 mt-1 break-all text-xs text-(color:--muted)">{conversation.userEmail} · {formatDateTime(conversation.updated)}</p>}
          </div>
          <button ref={closeRef} className={iconButton} type="button" onClick={onClose} aria-label={common("close")}><X size={18} aria-hidden="true" /></button>
        </header>
        <div className="grid content-start gap-3 overflow-y-auto bg-(--ash-50) p-4 max-sm:p-3">
          {!conversation && !error && <p className={stateBox} role="status"><LoaderCircle className="animate-spin" size={16} aria-hidden="true" /> {t("loading")}</p>}
          {error && <p className={errorBox} role="alert">{error}</p>}
          {conversation && conversation.messages.length === 0 && <p className={stateBox}>{t("empty")}</p>}
          {conversation?.messages.map((message, index) => {
            const mine = message.role === "user";
            return (
              <article key={index} className={`grid max-w-[88%] gap-1.5 ${mine ? "justify-self-end" : "justify-self-start"}`}>
                <p className={`m-0 flex items-center gap-1.5 text-[11px] font-semibold text-(color:--muted) ${mine ? "justify-end" : ""}`}>
                  {!mine && <Bot size={13} aria-hidden="true" />}{mine ? t("user") : t("assistant")}
                  {message.at && <time className="font-normal tabular-nums" dateTime={new Date(message.at).toISOString()}>{formatDateTime(new Date(message.at).toISOString())}</time>}
                </p>
                {message.content && <div className={`whitespace-pre-wrap break-words rounded-[14px] px-3.5 py-2.5 text-[13px] leading-relaxed ${mine ? "rounded-br-[4px] bg-(--ash-950) text-(color:--paper)" : "rounded-bl-[4px] border border-(color:--line) bg-(--paper) text-(color:--ink)"}`}>{message.content}</div>}
                {message.attachments.length > 0 && <p className={`m-0 flex flex-wrap items-center gap-1.5 text-[11px] text-(color:--ash-700) ${mine ? "justify-end" : ""}`}><Paperclip size={12} aria-hidden="true" /><span className="sr-only">{t("attachments")}:</span>{message.attachments.join(", ")}</p>}
                {message.tools.length > 0 && (
                  <p className="m-0 flex flex-wrap items-center gap-1.5 text-[11px] text-(color:--ash-700)">
                    <Wrench size={12} aria-hidden="true" /><span className="sr-only">{t("tools")}:</span>
                    {message.tools.map((tool) => <span key={tool} className="rounded bg-(--ash-150) px-1.5 py-0.5 font-mono text-[10px]">{tool}</span>)}
                  </p>
                )}
                {message.cards.map((card) => (
                  <div key={card.token} className="grid gap-2 rounded-[10px] border border-(color:--ash-300) bg-(--paper) p-3 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold">{kindLabel(card.kind)}{card.leadName && <span className="font-normal text-(color:--ash-700)"> · {card.leadName}</span>}</span>
                      <span className={`rounded-full px-[7px] py-0.5 text-[10px] font-bold ${cardStatePill[card.state]}`}>{t(`states.${card.state}`)}</span>
                    </div>
                    {card.email && (
                      <dl className="m-0 grid gap-1 border-t border-(color:--ash-150) pt-2">
                        <div className="flex flex-wrap gap-1"><dt className="text-(color:--muted)">{t("emailDraft")}:</dt><dd className="m-0 break-all">{card.email.to || "—"}</dd></div>
                        <dd className="m-0 font-semibold">{card.email.subject}</dd>
                        <dd className="m-0 whitespace-pre-wrap break-words text-(color:--ash-800)">{card.email.body}</dd>
                      </dl>
                    )}
                  </div>
                ))}
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}
