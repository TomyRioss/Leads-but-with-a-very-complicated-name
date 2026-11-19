"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AtSign, ChevronRight, LayoutDashboard, LoaderCircle, Search, Star, X, Plus } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { LEAD_DRAG_TYPE, requestLeadMention, type MentionLeadOption } from "@/app/[locale]/lead-suite/lead-mention-popover";

type View = "saved" | "recent" | "contacted";
type SidebarTab = "leads" | "messages";
type MessageModel = { id: string; name: string; text: string; isDefault: boolean };
type Lead = MentionLeadOption;
const VIEWS: View[] = ["saved", "recent", "contacted"];

// Open/closed survives reloads; starts closed (memory fallback when storage is blocked).
const OPEN_KEY = "leadta:leadtita-leads-open";
let openMemory = false;
const openListeners = new Set<() => void>();
function readOpen() {
  try { return localStorage.getItem(OPEN_KEY) === "1"; } catch { return openMemory; }
}
function writeOpen(value: boolean) {
  openMemory = value;
  try { localStorage.setItem(OPEN_KEY, value ? "1" : "0"); } catch { /* memory keeps it for this tab */ }
  openListeners.forEach((listener) => listener());
}
function subscribeOpen(listener: () => void) {
  openListeners.add(listener);
  return () => { openListeners.delete(listener); };
}

/** Right-hand Lead Suite panel of Leadtita: search, saved / recent / contacted leads, one click to @mention in the chat. */
export function LeadsSidebar() {
  const t = useTranslations("leadSuiteChat.leadsSidebar");
  const ts = useTranslations("leadSuiteChat");
  const locale = useLocale();
  const open = useSyncExternalStore(subscribeOpen, readOpen, () => false);
  const [view, setView] = useState<View>("saved");
  const [activeTab, setActiveTab] = useState<SidebarTab>("leads");
  const [query, setQuery] = useState("");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [reload, setReload] = useState(0);
  const [models, setModels] = useState<MessageModel[]>([]);
  const [modelsStatus, setModelsStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [modelsAction, setModelsAction] = useState(false);
  const [expandedModel, setExpandedModel] = useState<MessageModel | null>(null);
  const [modelError, setModelError] = useState("");
  const [addingModel, setAddingModel] = useState(false);
  const [editingModel, setEditingModel] = useState<string | null>(null);
  const [editModelName, setEditModelName] = useState("");
  const [modelText, setModelText] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const expandedModelDialogRef = useRef<HTMLDialogElement>(null);
  const term = query.trim();

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setStatus("loading");
      try {
        const url = term ? `/api/lead-suite/leads?mention=1&limit=20&q=${encodeURIComponent(term)}` : `/api/lead-suite/leads?view=${view}`;
        const response = await fetch(url, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error(String(response.status));
        setLeads(((await response.json()) as { items?: Lead[] }).items ?? []);
        setStatus("ready");
      } catch {
        if (!controller.signal.aborted) setStatus("error");
      }
    }, term ? 200 : 0);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [open, view, term, reload]);

  useEffect(() => {
    if (!open || activeTab !== "messages" || modelsStatus === "ready") return;
    const controller = new AbortController();
    fetch("/api/lead-suite/chat/message-models", { cache: "no-store", signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error(); return response.json() as Promise<{ items?: MessageModel[] }>; })
      .then((data) => { setModels(data.items ?? []); setModelsStatus("ready"); })
      .catch(() => { if (!controller.signal.aborted) setModelsStatus("error"); });
    return () => controller.abort();
  }, [open, activeTab, modelsStatus]);

  const close = () => { writeOpen(false); requestAnimationFrame(() => toggleRef.current?.focus()); };

  useEffect(() => {
    const dialog = expandedModelDialogRef.current;
    if (expandedModel && dialog && !dialog.open) dialog.showModal();
  }, [expandedModel]);

  async function toggleSaved(lead: Lead) {
    const saved = !lead.saved;
    const apply = (value: boolean) => setLeads((current) => current.flatMap((item) => item.id !== lead.id ? [item] : !value && view === "saved" && !term ? [] : [{ ...item, saved: value }]));
    apply(saved);
    try {
      const response = await fetch("/api/lead-suite/leads/saved", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leadId: lead.id, saved }) });
      if (!response.ok) throw new Error(String(response.status));
    } catch {
      // Unsaving from the saved tab removed the row: reload it instead of guessing its position.
      if (!saved && view === "saved" && !term) setReload((value) => value + 1);
      else apply(!saved);
    }
  }

  async function updateModel(method: "POST" | "PATCH" | "DELETE", payload: Record<string, string | boolean>, errorKey: string) {
    setModelsAction(true); setModelError("");
    try {
      const queryString = method === "DELETE" ? `?id=${encodeURIComponent(String(payload.id))}` : "";
      const response = await fetch(`/api/lead-suite/chat/message-models${queryString}`, {
        method,
        ...(method !== "DELETE" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) } : {}),
      });
      if (!response.ok) throw new Error();
      if (method === "DELETE") setModels((items) => items.filter((item) => item.id !== payload.id));
      else {
        const data = await response.json() as { item: MessageModel };
        setModels((items) => method === "POST" ? [data.item, ...items] : items.map((item) => item.id === data.item.id ? data.item : { ...item, isDefault: data.item.isDefault ? false : item.isDefault }));
      }
      return true;
    } catch { setModelError(t(errorKey)); return false; }
    finally { setModelsAction(false); }
  }

  async function saveModel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!modelText.trim()) return;
    const ok = await updateModel("POST", { text: modelText.trim() }, "modelError");
    if (ok) { setModelText(""); setAddingModel(false); }
  }

  async function renameModel(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    if (!editModelName.trim()) return;
    if (await updateModel("PATCH", { id, name: editModelName.trim() }, "modelError")) setEditingModel(null);
  }

  const empty = term ? t("emptySearch") : t(`empty.${view}`);
  // Both stay mounted so open/close can animate; the closed side is inert (no focus, no screen reader).
  return (
    <>
    <button ref={toggleRef} type="button" className={`leads-sidebar__tab${open ? " is-hidden" : ""}`} inert={open} onClick={() => { writeOpen(true); window.setTimeout(() => searchRef.current?.focus({ preventScroll: true }), 50); }} aria-expanded={open} aria-controls="leads-sidebar">
      <LayoutDashboard aria-hidden="true" size={22} strokeWidth={1.9} /><span>{t("title")}</span>
    </button>
    <aside id="leads-sidebar" className={`leads-sidebar${open ? " is-open" : ""}`} inert={!open} aria-labelledby="leads-sidebar-title" onKeyDown={(event) => { if (event.key === "Escape") close(); }}>
      <div className="leads-sidebar__panel">
      <header className="leads-sidebar__head">
        <h2 id="leads-sidebar-title">{t("title")}</h2>
        <button type="button" className="leads-sidebar__close" onClick={close} aria-label={t("close")} title={t("close")}><X aria-hidden="true" size={18} /></button>
      </header>
      <div className="leads-sidebar__section-tabs" role="tablist" aria-label={t("title")}>
        {(["leads", "messages"] as const).map((tab) => <button key={tab} type="button" role="tab" id={`leads-sidebar-tab-${tab}`} aria-controls={`leads-sidebar-panel-${tab}`} aria-selected={activeTab === tab} tabIndex={activeTab === tab ? 0 : -1} onClick={() => { setActiveTab(tab); setQuery(""); }} onKeyDown={(event) => { if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); const next = activeTab === "leads" ? "messages" : "leads"; setActiveTab(next); document.getElementById(`leads-sidebar-tab-${next}`)?.focus(); } }}>{t(tab === "leads" ? "leadsTab" : "messagesTab")}</button>)}
      </div>
      {activeTab === "leads" ? <div id="leads-sidebar-panel-leads" role="tabpanel" aria-labelledby="leads-sidebar-tab-leads" className="leads-sidebar__tab-panel">
      <label className="leads-sidebar__search">
        <Search aria-hidden="true" size={15} />
        <span className="ls-chat__sr">{t("search")}</span>
        <input ref={searchRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("search")} maxLength={80} />
      </label>
      {term ? null : (
        <div className="leads-sidebar__tabs" role="tablist" aria-label={t("title")}>
          {VIEWS.map((value) => (
            <button key={value} type="button" role="tab" aria-selected={view === value} className="leads-sidebar__view" onClick={() => setView(value)}>{t(`views.${value}`)}</button>
          ))}
        </div>
      )}
      <p className="leads-sidebar__hint">{t("hint")}</p>
      <div className="leads-sidebar__list" role={term ? undefined : "tabpanel"} aria-busy={status === "loading"}>
        {status === "loading" && !leads.length ? <p className="leads-sidebar__state" role="status"><LoaderCircle className="ls-chat__spin" aria-hidden="true" size={15} />{ts("mentionLoading")}</p>
          : status === "error" ? <p className="leads-sidebar__state" role="alert">{t("error")} <button type="button" onClick={() => setReload((value) => value + 1)}>{ts("retry")}</button></p>
            : !leads.length ? <p className="leads-sidebar__state">{empty}</p>
              : (
                <ul>
                  {leads.map((lead) => (
                    <li key={lead.id} className="leads-sidebar__item">
                      <button
                        type="button"
                        className="leads-sidebar__lead"
                        draggable
                        onDragStart={(event) => {
                          event.dataTransfer.setData(LEAD_DRAG_TYPE, JSON.stringify({ id: lead.id, name: lead.name }));
                          event.dataTransfer.setData("text/plain", `@${lead.name}`);
                          event.dataTransfer.effectAllowed = "copy";
                        }}
                        onClick={() => requestLeadMention(lead)} aria-label={t("mention", { lead: lead.name })} title={t("mention", { lead: lead.name })}>
                        <span className="leads-sidebar__lead-top">
                          <span className="leads-sidebar__name">{lead.name}</span>
                          {lead.contactStatus ? <span className={`ls-chat__mention-status is-${lead.contactStatus}`}>{ts(`statuses.${lead.contactStatus}`)}</span> : null}
                        </span>
                        <span className="leads-sidebar__meta">{[lead.category, lead.city, view === "recent" && !term && lead.batchDate ? new Date(lead.batchDate).toLocaleDateString(locale, { day: "numeric", month: "short" }) : ""].filter(Boolean).join(" · ") || ts("mentionLead")}</span>
                        <AtSign className="leads-sidebar__at" aria-hidden="true" size={15} />
                      </button>
                      <button type="button" className="leads-sidebar__save" onClick={() => void toggleSaved(lead)} aria-pressed={Boolean(lead.saved)} aria-label={t(lead.saved ? "unsave" : "save", { lead: lead.name })} title={t(lead.saved ? "unsave" : "save", { lead: lead.name })}>
                        <Star aria-hidden="true" size={16} fill={lead.saved ? "currentColor" : "none"} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
      </div>
      <Link className="leads-sidebar__all" href="/lead-suite">{t("viewAll")}<ChevronRight aria-hidden="true" size={15} /></Link>
      </div> : <div id="leads-sidebar-panel-messages" role="tabpanel" aria-labelledby="leads-sidebar-tab-messages" className="leads-sidebar__tab-panel leads-sidebar__models">
        {modelsStatus === "loading" || modelsStatus === "idle" ? <p className="leads-sidebar__state" role="status"><LoaderCircle className="ls-chat__spin" aria-hidden="true" size={15} />{t("loadingModels")}</p>
          : modelsStatus === "error" ? <p className="leads-sidebar__state" role="alert">{t("modelError")} <button type="button" onClick={() => { setModelsStatus("idle"); }}>{ts("retry")}</button></p>
            : models.length ? <ul className="leads-sidebar__model-list">{models.map((model) => <li key={model.id} className="leads-sidebar__model">
                <div className="leads-sidebar__model-heading"><strong>{model.name}</strong>{model.isDefault ? <span className="leads-sidebar__default">{t("defaultBadge")}</span> : null}</div>
                <button type="button" className="leads-sidebar__model-preview" onClick={() => setExpandedModel(model)} aria-label={t("readFullMessage", { name: model.name })}>{model.text}</button>
                <div className="leads-sidebar__model-actions">
                  <button type="button" disabled={modelsAction} onClick={() => { setEditingModel(model.id); setEditModelName(model.name); }}>{t("renameModel")}</button>
                  <button type="button" disabled={modelsAction} onClick={() => void updateModel("PATCH", { id: model.id, isDefault: !model.isDefault }, "defaultError")}>{t("makeDefault")}</button>
                  <button type="button" disabled={modelsAction} onClick={() => void updateModel("DELETE", { id: model.id }, "removeError")}>{t("removeModel")}</button>
                </div>
                {editingModel === model.id ? <form className="leads-sidebar__model-rename" onSubmit={(event) => void renameModel(event, model.id)}>
                  <label><span>{t("modelName")}</span><input value={editModelName} onChange={(event) => setEditModelName(event.target.value)} maxLength={80} required autoFocus /></label>
                  <div><button type="submit" disabled={modelsAction || !editModelName.trim()}>{modelsAction ? <LoaderCircle className="ls-chat__spin" aria-hidden="true" size={14} /> : null}{t("saveModelName")}</button><button type="button" onClick={() => setEditingModel(null)}>{t("cancel")}</button></div>
                </form> : null}
              </li>)}</ul> : <p className="leads-sidebar__state">{t("modelsEmpty")}</p>}
        {modelError && modelsStatus === "ready" ? <p className="leads-sidebar__model-error" role="alert">{modelError}</p> : null}
        {addingModel ? <form className="leads-sidebar__model-form" onSubmit={(event) => void saveModel(event)}>
          <label>{t("modelText")}<textarea value={modelText} onChange={(event) => setModelText(event.target.value)} placeholder={t("textPlaceholder")} maxLength={4096} rows={5} required /></label>
          <p>{t("nameGenerated")}</p>
          <div><button type="submit" disabled={modelsAction || !modelText.trim()}>{modelsAction ? <LoaderCircle className="ls-chat__spin" aria-hidden="true" size={14} /> : null}{t("saveModel")}</button><button type="button" onClick={() => { setAddingModel(false); setModelText(""); }}>{t("cancel")}</button></div>
        </form> : <button type="button" className="leads-sidebar__add-model" onClick={() => setAddingModel(true)}><Plus aria-hidden="true" size={16} />{t("addModel")}</button>}
      </div>}
      </div>
    </aside>
    <dialog ref={expandedModelDialogRef} className="leads-sidebar__model-dialog" aria-labelledby="expanded-message-model-title" onClose={() => setExpandedModel(null)}>
      {expandedModel ? <>
        <header><h2 id="expanded-message-model-title">{expandedModel.name}</h2><button type="button" onClick={() => expandedModelDialogRef.current?.close()} aria-label={t("closeFullMessage")}><X aria-hidden="true" size={18} /></button></header>
        <p>{expandedModel.text}</p>
      </> : null}
    </dialog>
    </>
  );
}
