"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CalendarClock, LoaderCircle, Pencil, Plus, RefreshCw, Search, X } from "lucide-react";
import { SiGmail, SiWhatsapp } from "react-icons/si";
import { defaultSendAt, fromLocalInput, SCHEDULED_EVENT, sendAtValid, toLocalInput } from "./schedule-picker";
import "@/app/modal-dialog.css";
import "./scheduled.css";

type Item = { id: string; channel: "email" | "whatsapp"; leadId: string; leadName: string; recipient: string; subject: string; body: string; sendAt: string; status: "scheduled" | "sending" | "sent" | "failed" | "cancelled"; error: string; sentAt: string };
type Draft = { sendAt: string; subject: string; body: string };
type LeadOption = { id: string; name: string; category: string; city: string };
const CREATE_ERRORS = ["invalid_send_at", "invalid", "not_found", "needs_gmail", "needs_whatsapp", "schedule_limit", "whatsapp_monthly_limit"];
const ERRORS = ["gmail_daily_limit", "needs_gmail", "needs_whatsapp", "invalid_number", "send_failed", "interrupted"];
const editable = (item: Item) => item.status === "scheduled" || item.status === "failed";

/** "Programados" button under the chat's daily counters: pending count + the management modal. */
export function ScheduledButton() {
  const t = useTranslations("leadSuiteChat.scheduled");
  const [items, setItems] = useState<Item[] | null>(null);
  /** Free schedules left this month; null = unlimited (plan or owner). */
  const [freeLeft, setFreeLeft] = useState<number | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/scheduled", { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      const payload = await response.json() as { items?: Item[]; freeLeft?: number | null };
      setItems(payload.items ?? []);
      setFreeLeft(typeof payload.freeLeft === "number" ? payload.freeLeft : null);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load of the pending count
    void load();
    window.addEventListener(SCHEDULED_EVENT, load);
    return () => window.removeEventListener(SCHEDULED_EVENT, load);
  }, [load]);

  const pending = items?.filter((item) => item.status === "scheduled" || item.status === "sending").length ?? 0;
  const failed = items?.filter((item) => item.status === "failed").length ?? 0;

  return (
    <div className="ls-scheduled-row">
      <button type="button" className="ls-scheduled-button" onClick={() => { setOpen(true); void load(); }} aria-haspopup="dialog">
        <CalendarClock aria-hidden="true" size={14} />
        <span>{t("button")}</span>
        {pending ? <span className="ls-scheduled-button__count">{pending}</span> : null}
        {failed ? <span className="ls-scheduled-button__failed">{t("failedCount", { count: failed })}</span> : null}
      </button>
      <ScheduledDialog open={open} onClose={() => setOpen(false)} items={items} freeLeft={freeLeft} loadError={loadError} onReload={load} onChange={(next) => setItems((current) => current?.map((item) => (item.id === next.id ? next : item)) ?? current)} />
    </div>
  );
}

function ScheduledDialog({ open, onClose, items, freeLeft, loadError, onReload, onChange }: { open: boolean; onClose: () => void; items: Item[] | null; freeLeft: number | null; loadError: boolean; onReload: () => void; onChange: (item: Item) => void }) {
  const t = useTranslations("leadSuiteChat.scheduled");
  const locale = useLocale();
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ sendAt: "", subject: "", body: "" });
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const format = (iso: string) => (iso ? new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-AR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) : "");

  async function patch(item: Item, body: Record<string, unknown>) {
    setBusy(item.id);
    setRowError(null);
    try {
      const response = await fetch(`/api/scheduled/${encodeURIComponent(item.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json().catch(() => ({})) as { item?: Item; error?: string };
      if (!response.ok || !payload.item) throw new Error(payload.error ?? "update_failed");
      onChange(payload.item);
      setEditing(null);
      setConfirmCancel(null);
      window.dispatchEvent(new Event(SCHEDULED_EVENT));
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      setRowError({ id: item.id, message: t(`errors.${["invalid_send_at", "invalid", "not_editable", "not_found"].includes(code) ? code : "generic"}`) });
    } finally {
      setBusy(null);
    }
  }

  const startEdit = (item: Item) => {
    setEditing(item.id);
    setConfirmCancel(null);
    setRowError(null);
    setDraft({ sendAt: sendAtValid(item.sendAt) ? item.sendAt : new Date(Date.now() + 60 * 60_000).toISOString(), subject: item.subject, body: item.body });
  };

  const pending = items?.filter((item) => item.status === "scheduled" || item.status === "sending" || item.status === "failed") ?? [];
  const history = items?.filter((item) => item.status === "sent" || item.status === "cancelled").reverse() ?? [];

  const renderItem = (item: Item) => {
    const Icon = item.channel === "email" ? SiGmail : SiWhatsapp;
    const isEditing = editing === item.id;
    const draftValid = sendAtValid(draft.sendAt) && Boolean(draft.body.trim()) && (item.channel === "whatsapp" || Boolean(draft.subject.trim()));
    return (
      <li key={item.id} className={`ls-scheduled__item is-${item.status}`}>
        <div className="ls-scheduled__head">
          <span className={`ls-scheduled__channel is-${item.channel}`} aria-hidden="true"><Icon size={14} /></span>
          <div className="ls-scheduled__who">
            <strong>{item.leadName || item.recipient}</strong>
            <span>{item.recipient}</span>
          </div>
          <span className="ls-scheduled__status">{t(`status.${item.status}`, { channel: item.channel })}</span>
        </div>
        <p className="ls-scheduled__when">
          {item.status === "sent" ? t("sentAt", { date: format(item.sentAt || item.sendAt) }) : t("sendAt", { date: format(item.sendAt) })}
        </p>
        {item.status === "failed" && item.error ? <p className="ls-scheduled__error">{t(`reasons.${ERRORS.includes(item.error) ? item.error : "send_failed"}`)}</p> : null}

        {isEditing ? (
          <div className="ls-scheduled__form">
            <label><span>{t("fields.sendAt")}</span><input type="datetime-local" value={toLocalInput(draft.sendAt)} min={toLocalInput(new Date().toISOString())} onChange={(event) => { const next = fromLocalInput(event.target.value); if (next) setDraft({ ...draft, sendAt: next }); }} /></label>
            {item.channel === "email" ? <label><span>{t("fields.subject")}</span><input type="text" value={draft.subject} maxLength={200} onChange={(event) => setDraft({ ...draft, subject: event.target.value })} /></label> : null}
            <label><span>{t("fields.body")}</span><textarea value={draft.body} maxLength={item.channel === "email" ? 5000 : 1500} rows={item.channel === "email" ? 7 : 5} onChange={(event) => setDraft({ ...draft, body: event.target.value })} /></label>
            {!sendAtValid(draft.sendAt) ? <p className="ls-scheduled__error" role="alert">{t("errors.invalid_send_at")}</p> : null}
            <div className="ls-scheduled__actions">
              <button type="button" className="ls-scheduled__primary" disabled={!draftValid || busy === item.id} onClick={() => void patch(item, { sendAt: draft.sendAt, subject: draft.subject, body: draft.body })}>
                {busy === item.id ? <LoaderCircle className="modal-spin" aria-hidden="true" size={14} /> : null}{item.status === "failed" ? t("saveRetry") : t("save")}
              </button>
              <button type="button" className="ls-scheduled__secondary" disabled={busy === item.id} onClick={() => setEditing(null)}>{t("discard")}</button>
            </div>
          </div>
        ) : (
          <p className="ls-scheduled__preview">{item.subject ? <strong>{item.subject} · </strong> : null}{item.body}</p>
        )}

        {editable(item) && !isEditing ? (
          confirmCancel === item.id ? (
            <div className="ls-scheduled__confirm" role="group" aria-label={t("cancelTitle")}>
              <p>{t("cancelBody")}</p>
              <div className="ls-scheduled__actions">
                <button type="button" className="ls-scheduled__danger" disabled={busy === item.id} onClick={() => void patch(item, { action: "cancel" })}>{busy === item.id ? <LoaderCircle className="modal-spin" aria-hidden="true" size={14} /> : null}{t("cancelConfirm")}</button>
                <button type="button" className="ls-scheduled__secondary" disabled={busy === item.id} onClick={() => setConfirmCancel(null)}>{t("keep")}</button>
              </div>
            </div>
          ) : (
            <div className="ls-scheduled__actions">
              <button type="button" className="ls-scheduled__secondary" onClick={() => startEdit(item)}><Pencil aria-hidden="true" size={13} />{item.status === "failed" ? t("retry") : t("edit")}</button>
              <button type="button" className="ls-scheduled__link" onClick={() => { setConfirmCancel(item.id); setEditing(null); }}>{t("cancel")}</button>
            </div>
          )
        ) : null}
        {rowError?.id === item.id ? <p className="ls-scheduled__error" role="alert">{rowError.message}</p> : null}
      </li>
    );
  };

  return (
    <dialog ref={dialogRef} className="modal-dialog ls-scheduled-dialog" aria-labelledby={titleId} onClose={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      {open ? (
        <div className="modal-body">
          <header className="modal-head">
            <span className="modal-icon" aria-hidden="true"><CalendarClock size={20} /></span>
            <h2 id={titleId}>{t("title")}</h2>
            <button type="button" className="modal-close" onClick={onClose} aria-label={t("close")}><X size={18} aria-hidden="true" /></button>
          </header>
          <p className="modal-intro">{t("intro")}</p>
          {freeLeft !== null ? <p className="ls-scheduled__quota">{t("freeLeft", { count: freeLeft, limit: 10 })}</p> : null}
          {creating ? (
            <NewScheduleForm onDone={() => { setCreating(false); window.dispatchEvent(new Event(SCHEDULED_EVENT)); }} onCancel={() => setCreating(false)} />
          ) : (
            <button type="button" className="ls-scheduled__primary ls-scheduled__new" disabled={freeLeft === 0} onClick={() => setCreating(true)}>
              <Plus aria-hidden="true" size={15} />{t("new")}
            </button>
          )}

          {items === null && !loadError ? <p className="ls-scheduled__state"><LoaderCircle className="modal-spin" aria-hidden="true" size={16} />{t("loading")}</p> : null}
          {loadError ? (
            <p className="ls-scheduled__error" role="alert">{t("loadError")} <button type="button" className="ls-scheduled__link" onClick={onReload}><RefreshCw aria-hidden="true" size={13} />{t("reload")}</button></p>
          ) : null}

          {items !== null ? (
            <>
              <section aria-labelledby={`${titleId}-pending`}>
                <h3 id={`${titleId}-pending`} className="ls-scheduled__section">{t("pending", { count: pending.length })}</h3>
                {pending.length ? <ul className="ls-scheduled__list">{pending.map(renderItem)}</ul> : <p className="ls-scheduled__state">{t("empty")}</p>}
              </section>
              {history.length ? (
                <section aria-labelledby={`${titleId}-history`}>
                  <h3 id={`${titleId}-history`} className="ls-scheduled__section">{t("history")}</h3>
                  <ul className="ls-scheduled__list">{history.map(renderItem)}</ul>
                </section>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </dialog>
  );
}

/** Manual "Nuevo programado": channel, one of the user's leads (searched like @mentions), date and message. */
function NewScheduleForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const t = useTranslations("leadSuiteChat.scheduled.form");
  const errorsT = useTranslations("leadSuiteChat.scheduled.errors");
  const baseId = useId();
  const [channel, setChannel] = useState<"email" | "whatsapp">("email");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LeadOption[] | null>(null);
  const [lead, setLead] = useState<LeadOption | null>(null);
  const [sendAt, setSendAt] = useState(() => defaultSendAt());
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Lead search (debounced), same endpoint as the chat's @mentions; recent leads when the query is empty.
  useEffect(() => {
    if (lead) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/lead-suite/leads?mention=1&limit=6&q=${encodeURIComponent(query.trim())}`, { cache: "no-store", signal: controller.signal });
        const payload = await response.json().catch(() => ({})) as { items?: LeadOption[] };
        if (!controller.signal.aborted) setResults(response.ok ? payload.items ?? [] : []);
      } catch { /* aborted or offline: keep the previous list */ }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, lead]);

  const valid = Boolean(lead) && sendAtValid(sendAt) && Boolean(body.trim()) && (channel === "whatsapp" || Boolean(subject.trim()));

  async function submit() {
    if (!lead || !valid) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/scheduled", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel, leadId: lead.id, sendAt, subject, body }) });
      const payload = await response.json().catch(() => ({})) as { item?: unknown; error?: string };
      if (!response.ok || !payload.item) throw new Error(payload.error ?? "generic");
      onDone();
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "";
      setError(code === "recipient_missing" ? t(channel === "email" ? "missingEmail" : "missingWhatsapp") : errorsT(CREATE_ERRORS.includes(code) ? code : "generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="ls-scheduled__form ls-scheduled__new-form" onSubmit={(event) => { event.preventDefault(); void submit(); }} aria-labelledby={`${baseId}-title`}>
      <h3 id={`${baseId}-title`} className="ls-scheduled__section">{t("title")}</h3>

      <div className="ls-schedule__modes" role="group" aria-label={t("channel")}>
        <button type="button" aria-pressed={channel === "email"} onClick={() => setChannel("email")}><SiGmail aria-hidden="true" size={13} />Gmail</button>
        <button type="button" aria-pressed={channel === "whatsapp"} onClick={() => setChannel("whatsapp")}><SiWhatsapp aria-hidden="true" size={13} />WhatsApp</button>
      </div>

      {lead ? (
        <div className="ls-scheduled__lead">
          <span><strong>{lead.name}</strong>{[lead.category, lead.city].filter(Boolean).join(" · ")}</span>
          <button type="button" className="ls-scheduled__link" onClick={() => { setLead(null); setQuery(""); }}>{t("changeLead")}</button>
        </div>
      ) : (
        <div className="ls-scheduled__search">
          <label htmlFor={`${baseId}-lead`}><span>{t("lead")}</span></label>
          <div className="ls-scheduled__search-input">
            <Search aria-hidden="true" size={15} />
            <input id={`${baseId}-lead`} type="search" value={query} maxLength={120} placeholder={t("leadPlaceholder")} onChange={(event) => setQuery(event.target.value)} autoComplete="off" />
          </div>
          {results === null ? <p className="ls-scheduled__state"><LoaderCircle className="modal-spin" aria-hidden="true" size={14} />{t("searching")}</p>
            : results.length ? (
              <ul className="ls-scheduled__results" aria-label={t("results")}>
                {results.map((option) => (
                  <li key={option.id}>
                    <button type="button" onClick={() => setLead(option)}>
                      <strong>{option.name}</strong><span>{[option.category, option.city].filter(Boolean).join(" · ")}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="ls-scheduled__state">{t("noResults")}</p>}
        </div>
      )}

      <label><span>{t("sendAt")}</span><input type="datetime-local" value={toLocalInput(sendAt)} min={toLocalInput(new Date().toISOString())} onChange={(event) => { const next = fromLocalInput(event.target.value); if (next) setSendAt(next); }} /></label>
      {!sendAtValid(sendAt) ? <p className="ls-scheduled__error" role="alert">{errorsT("invalid_send_at")}</p> : null}
      {channel === "email" ? <label><span>{t("subject")}</span><input type="text" value={subject} maxLength={200} onChange={(event) => setSubject(event.target.value)} /></label> : null}
      <label><span>{t("body")}</span><textarea value={body} maxLength={channel === "email" ? 5000 : 1500} rows={channel === "email" ? 7 : 5} onChange={(event) => setBody(event.target.value)} /></label>
      <p className="ls-scheduled__hint">{t(channel === "email" ? "hintEmail" : "hintWhatsapp")}</p>
      {error ? <p className="ls-scheduled__error" role="alert">{error}</p> : null}

      <div className="ls-scheduled__actions">
        <button type="submit" className="ls-scheduled__primary" disabled={!valid || busy}>{busy ? <LoaderCircle className="modal-spin" aria-hidden="true" size={14} /> : <CalendarClock aria-hidden="true" size={14} />}{t("submit")}</button>
        <button type="button" className="ls-scheduled__secondary" disabled={busy} onClick={onCancel}>{t("cancel")}</button>
      </div>
    </form>
  );
}
