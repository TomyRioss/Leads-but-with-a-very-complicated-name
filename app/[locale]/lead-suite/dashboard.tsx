"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { CalendarClock, CircleAlert, MessageSquareText, PanelRightClose, PanelRightOpen, RefreshCw, Send, Sparkles, TrendingUp, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { BrandMark } from "@/app/brand-logo";
import { ErrorReportButton } from "@/app/feedback-dialog";
import type { LeadContact, LeadSuiteMetrics, WeeklyReport } from "@/lib/lead-suite";
import { LeadSuiteChat } from "./chat-panel";
import { ContactForm, ContactList, type ContactFormTarget } from "./contact-form";
import { LeadSuiteLeads } from "./leads-list";
import { LeadSuiteMetricsTab } from "./metrics-tab";

type DashboardData = { metrics: LeadSuiteMetrics; recentContacts: LeadContact[]; latestReport: WeeklyReport | null };
type LoadState = { status: "loading" } | { status: "error"; message: string; unauthorized: boolean } | { status: "ready"; data: DashboardData };

const rangeOptions = [7, 30, 90] as const;
const dayMs = 86_400_000;

// Pestañas: la activa vive en `?tab=` para refrescar o compartir sin perder la vista.
const TABS = ["summary", "leads", "metrics", "report", "leadtita"] as const;
type Tab = (typeof TABS)[number];
const TAB_EVENT = "ls-tab-change";
const parseTab = (value: string | null): Tab => (TABS as readonly string[]).includes(value ?? "") ? value as Tab : "summary";
const readTab = () => parseTab(new URLSearchParams(window.location.search).get("tab"));
const serverTab = (): Tab => "summary";
function subscribeTab(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  window.addEventListener(TAB_EVENT, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(TAB_EVENT, onChange);
  };
}
// Panel de Leadtita colapsable en desktop; la preferencia vive en localStorage (puede fallar en modo privado).
const CHAT_KEY = "leadta.leadSuite.chatCollapsed";
const CHAT_EVENT = "ls-chat-collapse";
function subscribeChat(onChange: () => void) {
  window.addEventListener(CHAT_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHAT_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}
// Copia en memoria: sin storage (modo privado) el panel igual se colapsa durante la visita.
let chatMemory: boolean | null = null;
function readChat() {
  if (chatMemory !== null) return chatMemory;
  try {
    return window.localStorage.getItem(CHAT_KEY) === "1";
  } catch {
    return false;
  }
}
function writeChatCollapsed(collapsed: boolean) {
  chatMemory = collapsed;
  try {
    window.localStorage.setItem(CHAT_KEY, collapsed ? "1" : "0");
  } catch {
    // Sin storage: el estado no persiste, pero el evento igual actualiza la vista.
  }
  window.dispatchEvent(new Event(CHAT_EVENT));
}

function writeTab(tab: Tab) {
  const url = new URL(window.location.href);
  if (tab === "summary") url.searchParams.delete("tab");
  else url.searchParams.set("tab", tab);
  window.history.replaceState(window.history.state, "", url);
  window.dispatchEvent(new Event(TAB_EVENT));
}

function Kpi({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="ls-kpi">
      <Icon size={16} aria-hidden className="ls-kpi-icon" />
      <span className="ls-kpi-label">{label}</span>
      <strong className="ls-kpi-value">{value}</strong>
    </div>
  );
}

export function LeadSuiteDashboard() {
  const t = useTranslations("leadSuite");
  const format = useFormatter();
  const [days, setDays] = useState<(typeof rangeOptions)[number]>(30);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const load = useCallback(() => setReloadKey((key) => key + 1), []);
  const tab = useSyncExternalStore(subscribeTab, readTab, serverTab);
  const chatCollapsed = useSyncExternalStore(subscribeChat, readChat, () => false);
  const [editingContact, setEditingContact] = useState<ContactFormTarget>(null);
  const [lastSaved, setLastSaved] = useState<LeadContact | null>(null);
  // En desktop el chat siempre está al costado: la pestaña "Leadtita" solo se ve en móvil; ahí el contenido principal queda en el resumen.
  const mainTab: Tab = tab === "leadtita" ? "summary" : tab;
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});

  // En móvil la barra de pestañas scrollea: mantiene la activa a la vista (también al entrar con ?tab=).
  useEffect(() => {
    tabRefs.current[tab]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [tab]);

  // Una sola carga de dashboard compartida por todas las pestañas. Al refrescar se mantienen los datos visibles; respuestas viejas se descartan.
  useEffect(() => {
    let cancelled = false;
    const to = new Date();
    const from = new Date(to.getTime() - days * dayMs);
    (async () => {
      try {
        const response = await fetch(`/api/lead-suite/dashboard?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`, { cache: "no-store" });
        const body = await response.json().catch(() => null) as (DashboardData & { error?: string }) | null;
        if (cancelled) return;
        if (!response.ok || !body?.metrics) setState({ status: "error", message: body?.error || t("error"), unauthorized: response.status === 401 });
        else setState({ status: "ready", data: body });
      } catch {
        if (!cancelled) setState({ status: "error", message: t("error"), unauthorized: false });
      }
    })();
    return () => { cancelled = true; };
  }, [days, reloadKey, t]);

  const formatDate = (value: string) => format.dateTime(new Date(value), { day: "numeric", month: "short" });
  const formatDateTime = (value: string) => format.dateTime(new Date(value), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  // Patrón tablist: ←/→ e Inicio/Fin mueven el foco y activan la pestaña (solo entre las visibles).
  function onTabKey(event: KeyboardEvent<HTMLDivElement>) {
    const visible = TABS.filter((item) => tabRefs.current[item]?.offsetParent !== null);
    const index = Math.max(0, visible.indexOf(tab));
    let next: Tab | undefined;
    if (event.key === "ArrowRight") next = visible[(index + 1) % visible.length];
    else if (event.key === "ArrowLeft") next = visible[(index - 1 + visible.length) % visible.length];
    else if (event.key === "Home") next = visible[0];
    else if (event.key === "End") next = visible[visible.length - 1];
    if (!next) return;
    event.preventDefault();
    writeTab(next);
    tabRefs.current[next]?.focus();
  }

  const data = state.status === "ready" ? state.data : null;
  const hasActivity = Boolean(data && (data.metrics.totalContactedLeads > 0 || data.recentContacts.length > 0));

  // Carga, error y vacío compartidos por las pestañas que dependen del dashboard.
  let dataState: ReactNode = null;
  if (state.status === "loading") {
    dataState = <p role="status" className="ls-state"><BrandMark className="brand-mark-loading" />{t("loading")}</p>;
  } else if (state.status === "error") {
    dataState = (
      <div role="alert" className="ls-state ls-state-error">
        <CircleAlert size={18} aria-hidden />
        <span>{state.unauthorized ? t("signIn") : state.message}</span>
        {!state.unauthorized && <button type="button" className="auth-secondary-button ls-button" onClick={load}>{t("retry")}</button>}
        {!state.unauthorized && <ErrorReportButton message={state.message} action="load_lead_suite_dashboard" />}
      </div>
    );
  } else if (!hasActivity) {
    dataState = (
      <div className="ls-empty">
        <MessageSquareText size={22} aria-hidden />
        <h2>{t("emptyTitle")}</h2>
        <p>{t("emptyBody")}</p>
        <button type="button" className="auth-secondary-button ls-button ls-empty-action" onClick={() => writeTab("leads")}>{t("goToLeads")}</button>
      </div>
    );
  }

  let summary: ReactNode = dataState;
  if (data && hasActivity) {
    const { metrics, recentContacts } = data;
    summary = (
      <>
        <div className="ls-kpis">
          <Kpi icon={Users} label={t("kpiContactedLeads")} value={format.number(metrics.totalContactedLeads)} />
          <Kpi icon={Send} label={t("kpiContactsInRange")} value={format.number(metrics.contactsInRange)} />
          <Kpi icon={TrendingUp} label={t("kpiReplyRate")} value={format.number(metrics.replyRate, { style: "percent", maximumFractionDigits: 0 })} />
          <Kpi icon={CalendarClock} label={t("kpiPending")} value={format.number(metrics.pendingFollowUps.length)} />
        </div>
        <div className="ls-grid">
          <section className="ls-card" aria-label={t("pending")}>
            <h2 className="ls-card-title">{t("pending")}</h2>
            {metrics.pendingFollowUps.length ? (
              <ul className="ls-list">
                {metrics.pendingFollowUps.map((lead) => (
                  <li key={lead.id}>
                    <div className="ls-list-head"><strong>{lead.name}</strong>{lead.category && <span className="ls-chip">{lead.category}</span>}</div>
                    {lead.lastContactedAt && <span className="ls-muted">{t("lastContact", { date: formatDateTime(lead.lastContactedAt) })}</span>}
                  </li>
                ))}
              </ul>
            ) : <p className="ls-muted">{t("pendingEmpty")}</p>}
          </section>
          <section className="ls-card" aria-label={t("recent")}>
            <h2 className="ls-card-title">{t("recent")}</h2>
            {recentContacts.length ? (
              <ContactList
                contacts={recentContacts.map((item) => (lastSaved && item.id === lastSaved.id ? lastSaved : item))}
                showLead
                onEdit={(item) => setEditingContact({ lead: { id: item.leadId, name: item.leadName }, contact: item })}
                onDeleted={() => load()}
              />
            ) : <p className="ls-muted">{t("noData")}</p>}
          </section>
        </div>
      </>
    );
  }

  let report: ReactNode = state.status === "ready" ? null : dataState;
  if (data) {
    const latestReport = data.latestReport;
    report = latestReport ? (
      <section className="ls-card ls-report" aria-label={t("report")}>
        <h2 className="ls-card-title"><Sparkles size={15} aria-hidden />{t("report")} <span className="ls-muted">{t("reportWeek", { date: formatDate(latestReport.weekStart) })}</span></h2>
        <p>{latestReport.summary}</p>
        {latestReport.suggestions.length > 0 && (
          <>
            <h3>{t("suggestions")}</h3>
            <ul>{latestReport.suggestions.map((suggestion, index) => <li key={index}>{suggestion}</li>)}</ul>
          </>
        )}
      </section>
    ) : (
      <div className="ls-empty">
        <Sparkles size={22} aria-hidden />
        <h2>{t("reportEmptyTitle")}</h2>
        <p>{t("reportEmptyBody")}</p>
        <button type="button" className="auth-secondary-button ls-button ls-empty-action" onClick={() => writeTab("leads")}>{t("goToLeads")}</button>
      </div>
    );
  }

  const showRange = tab === "summary" || tab === "metrics";

  return (
    <div className={`ls-shell${tab === "leadtita" ? " is-chat-tab" : ""}${chatCollapsed ? " is-chat-collapsed" : ""}`}>
      <main className="ls-main">
        <header className="ls-header">
          <div>
            <h1>{t("title")}<span className="ls-dot" aria-hidden>.</span></h1>
            <p className="ls-muted">{t("subtitle")}</p>
          </div>
          <div className="ls-controls">
            {showRange && (
              <div role="radiogroup" aria-label={t("range")} className="filter-segments">
                {rangeOptions.map((option) => (
                  <label key={option} className={`filter-segment${days === option ? " is-selected" : ""}`}>
                    <input type="radio" name="ls-range" value={option} checked={days === option} onChange={() => setDays(option)} />
                    <span>{t("rangeDays", { days: option })}</span>
                  </label>
                ))}
              </div>
            )}
            <button type="button" className="auth-secondary-button ls-icon-button" onClick={load} aria-label={t("refresh")} title={t("refresh")}><RefreshCw size={15} aria-hidden /></button>
          </div>
        </header>

        <div role="tablist" aria-label={t("tabsLabel")} className="filter-segments ls-tabs" onKeyDown={onTabKey}>
          {TABS.map((item) => (
            <button
              key={item}
              ref={(node) => { tabRefs.current[item] = node; }}
              type="button"
              role="tab"
              id={`ls-tab-${item}`}
              aria-selected={tab === item}
              aria-controls={`ls-panel-${item}`}
              tabIndex={tab === item ? 0 : -1}
              className={`ls-tab${tab === item ? " is-selected" : ""}${item === "leadtita" ? " ls-tab-mobile" : ""}`}
              onClick={() => writeTab(item)}
            >
              {t(`tabs.${item}`)}
            </button>
          ))}
        </div>

        <div className="ls-panels">
          <section role="tabpanel" id="ls-panel-summary" aria-labelledby="ls-tab-summary" className="ls-panel" hidden={mainTab !== "summary"} aria-live="polite">{summary}</section>
          <section role="tabpanel" id="ls-panel-leads" aria-labelledby="ls-tab-leads" className="ls-panel" hidden={mainTab !== "leads"}>
            <LeadSuiteLeads refreshKey={reloadKey} onSaved={load} />
          </section>
          <section role="tabpanel" id="ls-panel-metrics" aria-labelledby="ls-tab-metrics" className="ls-panel" hidden={mainTab !== "metrics"}>
            <LeadSuiteMetricsTab days={days} reloadKey={reloadKey} active={mainTab === "metrics"} />
          </section>
          <section role="tabpanel" id="ls-panel-report" aria-labelledby="ls-tab-report" className="ls-panel" hidden={mainTab !== "report"}>{report}</section>
        </div>
      </main>
      <aside id="ls-panel-leadtita" aria-labelledby="ls-tab-leadtita" className="ls-chat-slot">
        <button
          type="button"
          className="ls-chat-toggle"
          aria-expanded={!chatCollapsed}
          aria-controls="ls-chat-body"
          aria-label={chatCollapsed ? t("chatExpand") : t("chatCollapse")}
          title={chatCollapsed ? t("chatExpand") : t("chatCollapse")}
          onClick={() => writeChatCollapsed(!chatCollapsed)}
        >
          {chatCollapsed ? (
            <>
              <PanelRightOpen size={18} aria-hidden />
              <BrandMark className="ls-chat-rail-mark" />
              <span className="ls-chat-rail-label" aria-hidden>Leadtita</span>
            </>
          ) : <PanelRightClose size={18} aria-hidden />}
        </button>
        <div id="ls-chat-body" className="ls-chat-body"><LeadSuiteChat onActivity={load} /></div>
      </aside>
      <ContactForm target={editingContact} onClose={() => setEditingContact(null)} onSaved={({ contact }) => { setLastSaved(contact); setEditingContact(null); load(); }} />
    </div>
  );
}
