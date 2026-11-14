"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronLeft, ChevronRight, History, Search, UserRoundPlus } from "lucide-react";
import type { LeadContact, LeadContactStatus, LeadMatch } from "@/lib/lead-suite";
import { BrandMark } from "@/app/brand-logo";
import { ContactForm, ContactList, type ContactFormTarget } from "./contact-form";

type Filter = "" | LeadContactStatus;
type LeadsPage = { items: LeadMatch[]; page: number; totalPages: number };
type State = { status: "loading" } | { status: "error" } | { status: "ready"; data: LeadsPage };

const filters: Filter[] = ["", "not_contacted", "contacted", "replied", "meeting", "won", "lost"];

type HistoryState = { leadId: string; key: number; items?: LeadContact[]; error?: boolean };

/** Historial de contactos de un lead, con editar/eliminar en cada uno. Se pide solo al expandir. */
function LeadHistory({ leadId, reloadKey, saved, onEdit, onChanged }: { leadId: string; reloadKey: number; saved: LeadContact | null; onEdit: (contact: LeadContact) => void; onChanged: (lead: LeadMatch) => void }) {
  const t = useTranslations("leadSuite");
  const [state, setState] = useState<HistoryState | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(`/api/lead-suite/contacts?leadId=${encodeURIComponent(leadId)}`, { cache: "no-store", signal: controller.signal });
        const body = await response.json().catch(() => null) as { items?: LeadContact[] } | null;
        if (controller.signal.aborted) return;
        setState(response.ok && body?.items ? { leadId, key: reloadKey, items: body.items } : { leadId, key: reloadKey, error: true });
      } catch {
        if (!controller.signal.aborted) setState({ leadId, key: reloadKey, error: true });
      }
    })();
    return () => controller.abort();
  }, [leadId, reloadKey]);

  if (!state || state.leadId !== leadId) return <p role="status" className="ls-muted ls-leads-loading"><BrandMark className="brand-mark-loading ls-loading-mark" />{t("loading")}</p>;
  if (state.error) return <p role="alert" className="ls-muted">{t("historyError")}</p>;
  if (!state.items?.length) return <p className="ls-muted">{t("historyEmpty")}</p>;
  return (
    <ContactList
      // El contacto recién guardado reemplaza al de la lista al instante: evita editar una versión vieja mientras se recarga.
      contacts={state.items.map((item) => (saved && item.id === saved.id ? saved : item))}
      onEdit={onEdit}
      onDeleted={({ deleted, leads }) => {
        setState((current) => current && current.items ? { ...current, items: current.items.filter((item) => !deleted.includes(item.id)) } : current);
        if (leads[0]) onChanged(leads[0]);
      }}
    />
  );
}

/** Todos los leads del usuario; "Cargar contacto" abre un formulario directo para ese lead. */
export function LeadSuiteLeads({ onSaved, refreshKey }: { onSaved: () => void; refreshKey: number }) {
  const t = useTranslations("leadSuite");
  const [filter, setFilter] = useState<Filter>("not_contacted");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [state, setState] = useState<State>({ status: "loading" });
  const [editing, setEditing] = useState<ContactFormTarget>(null);
  const [openLead, setOpenLead] = useState<string | null>(null);
  const [historyKey, setHistoryKey] = useState(0);
  const [lastSaved, setLastSaved] = useState<LeadContact | null>(null);
  const [saved, setSaved] = useState("");
  const returnFocus = useRef<HTMLButtonElement | null>(null);

  // Debounce de la búsqueda para no pedir en cada tecla.
  useEffect(() => {
    const timer = setTimeout(() => { setSearch(query.trim()); setPage(1); }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page) });
    if (filter) params.set("status", filter);
    if (search) params.set("q", search);
    (async () => {
      try {
        const response = await fetch(`/api/lead-suite/leads?${params}`, { cache: "no-store", signal: controller.signal });
        const body = await response.json().catch(() => null) as LeadsPage | null;
        if (controller.signal.aborted) return;
        setState(response.ok && body?.items ? { status: "ready", data: body } : { status: "error" });
      } catch {
        if (!controller.signal.aborted) setState({ status: "error" });
      }
    })();
    return () => controller.abort();
  }, [filter, search, page, refreshKey]);

  const data = state.status === "ready" ? state.data : null;

  // Actualiza la fila al instante; el refresco del dashboard la reordena o filtra después.
  function updateRow(lead: LeadMatch) {
    setState((current) => current.status === "ready"
      ? { status: "ready", data: { ...current.data, items: current.data.items.map((item) => (item.id === lead.id ? lead : item)) } }
      : current);
  }

  return (
    <section className="ls-card" aria-label={t("myLeads")}>
      <h2 className="ls-card-title">{t("myLeads")}</h2>
      <div className="ls-leads-toolbar">
        <label className="ls-leads-search">
          <Search size={15} aria-hidden />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("searchLeads")} aria-label={t("searchLeads")} maxLength={120} />
        </label>
        <div role="radiogroup" aria-label={t("filterLeads")} className="filter-segments ls-leads-filters">
          {filters.map((option) => (
            <label key={option || "all"} className={`filter-segment${filter === option ? " is-selected" : ""}`}>
              <input type="radio" name="ls-leads-filter" value={option} checked={filter === option} onChange={() => { setFilter(option); setPage(1); }} />
              <span>{option ? t(`statuses.${option}`) : t("allLeads")}</span>
            </label>
          ))}
        </div>
      </div>

      <p className="ls-sr" role="status">{saved}</p>
      <div aria-live="polite" aria-busy={state.status === "loading"}>
        {state.status === "error" ? (
          <p role="alert" className="ls-muted">{t("leadsError")}</p>
        ) : !data ? (
          <p role="status" className="ls-muted ls-leads-loading"><BrandMark className="brand-mark-loading ls-loading-mark" />{t("loading")}</p>
        ) : data.items.length === 0 ? (
          <p className="ls-muted">{t("leadsEmpty")}</p>
        ) : (
          <ul className="ls-leads">
            {data.items.map((lead) => (
              <li key={lead.id}>
                <div className="ls-leads-info">
                  <strong>{lead.name}</strong>
                  <span className="ls-muted">{[lead.category, lead.city].filter(Boolean).join(" · ")}</span>
                </div>
                <span className="ls-chip" data-status={lead.contactStatus}>{t(`statuses.${lead.contactStatus}`)}</span>
                <div className="ls-leads-actions">
                  {lead.contactStatus !== "not_contacted" && (
                    <button
                      type="button"
                      className={`auth-secondary-button ls-button ls-history-toggle${openLead === lead.id ? " is-open" : ""}`}
                      aria-expanded={openLead === lead.id}
                      aria-controls={`ls-history-${lead.id}`}
                      aria-label={t("historyAria", { name: lead.name })}
                      onClick={() => setOpenLead((current) => (current === lead.id ? null : lead.id))}
                    >
                      <History size={15} aria-hidden />{t("history")}<ChevronDown size={14} aria-hidden className="ls-history-chevron" />
                    </button>
                  )}
                  <button type="button" className="auth-secondary-button ls-button" onClick={(event) => { returnFocus.current = event.currentTarget; setSaved(""); setEditing({ lead }); }} aria-label={`${t("logContact")}: ${lead.name}`}>
                    <UserRoundPlus size={15} aria-hidden />{t("logContact")}
                  </button>
                </div>
                {openLead === lead.id && (
                  <div id={`ls-history-${lead.id}`} className="ls-history" role="region" aria-label={t("historyAria", { name: lead.name })}>
                    <LeadHistory
                      leadId={lead.id}
                      reloadKey={historyKey + refreshKey}
                      saved={lastSaved}
                      onEdit={(contact) => { returnFocus.current = document.activeElement instanceof HTMLButtonElement ? document.activeElement : null; setSaved(""); setEditing({ lead, contact }); }}
                      onChanged={(updated) => { updateRow(updated); setSaved(t("contactDeleted")); onSaved(); }}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {data && data.totalPages > 1 && (
        <nav className="ls-leads-pager" aria-label={t("pagination")}>
          <button type="button" className="auth-secondary-button ls-icon-button" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label={t("prevPage")}><ChevronLeft size={15} aria-hidden /></button>
          <span className="ls-muted">{t("pageOf", { page: data.page, total: data.totalPages })}</span>
          <button type="button" className="auth-secondary-button ls-icon-button" disabled={page >= data.totalPages} onClick={() => setPage(page + 1)} aria-label={t("nextPage")}><ChevronRight size={15} aria-hidden /></button>
        </nav>
      )}
      <ContactForm
        target={editing}
        onClose={() => { setEditing(null); returnFocus.current?.focus(); }}
        onSaved={({ contact, lead }) => {
          updateRow(lead);
          setLastSaved(contact);
          setSaved(t("formSaved", { name: lead.name }));
          setEditing(null);
          setHistoryKey((key) => key + 1);
          returnFocus.current?.focus();
          onSaved();
        }}
      />
    </section>
  );
}
