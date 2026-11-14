"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ComponentType, FormEvent } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { CalendarPlus, Ellipsis, ExternalLink, Handshake, LoaderCircle, Mail, Pencil, Phone, Sparkles, Trash2, UserRoundPen, UserRoundPlus, Video, X } from "lucide-react";
import { FaInstagram, FaLinkedin, FaWhatsapp } from "react-icons/fa";
import { CONTACT_STATUSES } from "@/lib/lead-suite";
import type { ContactChannel, ContactStatus, LeadContact, LeadMatch } from "@/lib/lead-suite";
import { GoogleFeatureConnectButton } from "@/app/google-drive-connect";
import "@/app/referral-dialog.css";

type ChannelIcon = ComponentType<{ size?: number; "aria-hidden"?: boolean | "true" }>;
export const channelIcons: Record<ContactChannel, ChannelIcon> = {
  whatsapp: FaWhatsapp,
  email: Mail,
  phone: Phone,
  instagram: FaInstagram,
  linkedin: FaLinkedin,
  in_person: Handshake,
  other: Ellipsis,
};
const CHANNELS = Object.keys(channelIcons) as ContactChannel[];
type Field = "channel" | "contactedAt" | "status" | "message" | "notes";
type Saved = { contact: LeadContact; lead: LeadMatch };
const MEETING_MINUTES = [15, 30, 45, 60, 90, 120];

/** Event / Meet links appended to the notes when a meeting was scheduled ("Evento: …", "Meet: …"). */
export function meetingLinks(notes: string) {
  const event = notes.match(/^Evento: (https:\/\/\S+)$/m)?.[1] ?? "";
  const meet = notes.match(/^Meet: (https:\/\/\S+)$/m)?.[1] ?? "";
  const rest = notes.split("\n").filter((line) => !/^(Evento|Meet): https:\/\//.test(line)).join("\n").trim();
  return { event, meet, rest };
}

/** Lead mínimo para el formulario: desde "Contactos recientes" solo se conoce id y nombre. */
export type FormLead = Pick<LeadMatch, "id" | "name"> & Partial<Pick<LeadMatch, "category" | "city">>;
/** Sin `contact` es un alta; con `contact` se edita ese registro. */
export type ContactFormTarget = { lead: FormLead; contact?: LeadContact } | null;

/** Fecha/hora local en formato `datetime-local` (YYYY-MM-DDTHH:mm). */
function toLocalInput(date: Date) {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

type Props = { target: ContactFormTarget; onClose: () => void; onSaved: (result: Saved) => void };

/** Diálogo para registrar o editar un contacto sin usar el chat, con "Modificar con IA" (la IA solo rellena; guarda el usuario). */
export function ContactForm({ target, onClose, onSaved }: Props) {
  const t = useTranslations("leadSuite");
  const dialogRef = useRef<HTMLDialogElement>(null);
  // Ids únicos: el formulario se monta en más de un lugar (Mis leads y Resumen).
  const uid = useId();
  const [channel, setChannel] = useState<ContactChannel>("whatsapp");
  const [contactedAt, setContactedAt] = useState("");
  const [status, setStatus] = useState<ContactStatus>("contacted");
  const [message, setMessage] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [aiText, setAiText] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiStatus, setAiStatus] = useState("");
  const [changed, setChanged] = useState<ReadonlySet<Field>>(new Set());
  const [openedFor, setOpenedFor] = useState<ContactFormTarget>(null);
  // "Agendar en Google Calendar" (only for status Reunión). calendarReady: null = unknown, false = not connected.
  const [schedule, setSchedule] = useState(false);
  const [meetingAt, setMeetingAt] = useState("");
  const [meetingMinutes, setMeetingMinutes] = useState(30);
  const [invite, setInvite] = useState(true);
  const [meetLink, setMeetLink] = useState(false);
  const [calendarReady, setCalendarReady] = useState<boolean | null>(null);
  const [savedWithWarning, setSavedWithWarning] = useState<Saved | null>(null);
  const editing = target?.contact;
  const busy = saving || aiBusy;

  // Al abrir para otro lead/contacto, reinicia o precarga el formulario (estado derivado, sin efecto).
  if (target && target !== openedFor) {
    setOpenedFor(target);
    const contact = target.contact;
    setChannel(contact?.channel ?? "whatsapp");
    setContactedAt(toLocalInput(contact ? new Date(contact.contactedAt) : new Date()));
    setStatus(contact?.status ?? "contacted");
    setMessage(contact?.message ?? "");
    setNotes(contact?.notes ?? "");
    setError("");
    setAiText("");
    setAiStatus("");
    setChanged(new Set());
    setSchedule(false);
    setMeetingAt("");
    setMeetingMinutes(30);
    setInvite(true);
    setMeetLink(false);
    setSavedWithWarning(null);
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (target && !dialog.open) dialog.showModal();
    if (!target && dialog.open) dialog.close();
  }, [target]);

  // Calendar permission, checked once the user picks Reunión (one request per opened form).
  useEffect(() => {
    if (status !== "meeting" || calendarReady !== null || !target) return;
    let current = true;
    fetch("/api/integrations/google/status", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { connected?: boolean; features?: { calendar?: boolean } } | null) => { if (current) setCalendarReady(Boolean(payload?.connected && payload.features?.calendar)); })
      .catch(() => { if (current) setCalendarReady(false); });
    return () => { current = false; };
  }, [status, calendarReady, target]);

  function close() {
    if (busy) return;
    // A contact saved with a Calendar warning still counts as saved.
    if (savedWithWarning) onSaved(savedWithWarning);
    else onClose();
  }

  // Un cambio manual quita el resaltado de "lo cambió la IA" en ese campo.
  function touch(field: Field) {
    if (changed.has(field)) setChanged((current) => { const next = new Set(current); next.delete(field); return next; });
  }

  async function aiFill() {
    if (!target || busy || !aiText.trim()) return;
    setAiBusy(true);
    setAiStatus("");
    setError("");
    try {
      const date = new Date(contactedAt);
      const response = await fetch("/api/lead-suite/contacts/ai-fill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instruction: aiText.trim(),
          leadName: target.lead.name,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          current: { channel, status, message, notes, ...(Number.isNaN(date.getTime()) ? {} : { contactedAt: date.toISOString() }) },
        }),
      });
      const body = await response.json().catch(() => null) as { changes?: Partial<Record<Field, string>>; error?: string } | null;
      if (!response.ok || !body?.changes) throw new Error(response.status === 429 ? t("aiLimit") : body?.error || t("aiError"));
      const fields = Object.keys(body.changes) as Field[];
      const { changes } = body;
      if (changes.channel) setChannel(changes.channel as ContactChannel);
      if (changes.status) setStatus(changes.status as ContactStatus);
      if (changes.contactedAt) setContactedAt(toLocalInput(new Date(changes.contactedAt)));
      if (changes.message !== undefined) setMessage(changes.message);
      if (changes.notes !== undefined) setNotes(changes.notes);
      setChanged(new Set(fields));
      setAiStatus(fields.length
        ? t("aiChanged", { fields: fields.map((field) => t(`aiFields.${field}`)).join(", ") })
        : t("aiNoChanges"));
    } catch (caught) {
      setAiStatus("");
      setError(caught instanceof Error && caught.message ? caught.message : t("aiError"));
    } finally {
      setAiBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!target || busy) return;
    const date = new Date(contactedAt);
    if (!contactedAt || Number.isNaN(date.getTime())) return setError(t("formDateInvalid"));
    if (date.getTime() > Date.now() + 60_000) return setError(t("formDateFuture"));
    const wantsMeeting = status === "meeting" && schedule && calendarReady === true;
    const meetingDate = new Date(meetingAt);
    if (wantsMeeting && (!meetingAt || Number.isNaN(meetingDate.getTime()))) return setError(t("calendarDateInvalid"));
    setSaving(true);
    setError("");
    try {
      const fields = {
        channel, contactedAt: date.toISOString(), status, message, notes,
        ...(wantsMeeting ? { calendar: { start: meetingDate.toISOString(), durationMinutes: meetingMinutes, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", invite, meet: meetLink } } : {}),
      };
      const response = await fetch(editing ? `/api/lead-suite/contacts/${encodeURIComponent(editing.id)}` : "/api/lead-suite/contacts", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing ? fields : { leadId: target.lead.id, ...fields }),
      });
      const body = await response.json().catch(() => null) as { contact?: LeadContact; lead?: LeadMatch; error?: string; calendarError?: "needs_calendar" | "failed" } | null;
      if (!response.ok || !body?.contact || !body.lead) throw new Error(body?.error || t("formError"));
      if (body.calendarError) {
        // Saved, but no event: keep the dialog open with the warning; closing reports the save.
        setSavedWithWarning({ contact: body.contact, lead: body.lead });
        setError(t(body.calendarError === "needs_calendar" ? "calendarNeeds" : "calendarFailed"));
        return;
      }
      onSaved({ contact: body.contact, lead: body.lead });
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : t("formError"));
    } finally {
      setSaving(false);
    }
  }

  const ai = (field: Field) => (changed.has(field) ? " is-ai-changed" : "");
  const lead = target?.lead;

  return (
    <dialog
      ref={dialogRef}
      className="referral-dialog ls-contact-dialog"
      aria-labelledby={`${uid}-title`}
      onClose={onClose}
      onCancel={(event) => { if (busy) event.preventDefault(); }}
      onClick={(event) => { if (event.target === event.currentTarget) close(); }}
    >
      {lead && (
        <form className="referral-body ls-contact-form" onSubmit={submit} noValidate>
          <div className="referral-head">
            <span className="referral-icon" aria-hidden="true">{editing ? <UserRoundPen size={18} strokeWidth={1.8} /> : <UserRoundPlus size={18} strokeWidth={1.8} />}</span>
            <h2 id={`${uid}-title`}>{editing ? t("formEditTitle") : t("formTitle")}</h2>
            <button type="button" className="referral-close" onClick={close} aria-label={t("formClose")}><X size={18} aria-hidden="true" /></button>
          </div>
          <p className="referral-intro"><strong className="ls-contact-lead">{lead.name}</strong>{[lead.category, lead.city].filter(Boolean).length ? ` · ${[lead.category, lead.city].filter(Boolean).join(" · ")}` : ""}</p>

          <div className="ls-ai-fill">
            <label className="ls-contact-field" htmlFor={`${uid}-ai`}>
              <span className="referral-label"><Sparkles size={14} aria-hidden="true" /> {t("aiLabel")}</span>
            </label>
            <div className="ls-ai-fill-row">
              <input
                id={`${uid}-ai`}
                type="text"
                value={aiText}
                maxLength={300}
                placeholder={t("aiPlaceholder")}
                onChange={(event) => setAiText(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void aiFill(); } }}
                disabled={busy}
                aria-describedby={`${uid}-ai-status`}
              />
              <button type="button" className="auth-secondary-button ls-button ls-ai-fill-button" onClick={() => void aiFill()} disabled={busy || !aiText.trim()}>
                {aiBusy ? <LoaderCircle className="referral-spin" size={15} aria-hidden="true" /> : <Sparkles size={15} aria-hidden="true" />}
                {aiBusy ? t("aiWorking") : t("aiButton")}
              </button>
            </div>
            <p id={`${uid}-ai-status`} className="ls-ai-fill-status" role="status">{aiStatus || t("aiHint")}</p>
          </div>

          <fieldset className={`ls-contact-channels${ai("channel")}`} disabled={busy}>
            <legend className="referral-label">{t("formChannel")}</legend>
            {CHANNELS.map((option) => {
              const Icon = channelIcons[option];
              return (
                <label key={option} className={`ls-contact-channel${channel === option ? " is-selected" : ""}`}>
                  <input type="radio" name={`${uid}-channel`} value={option} checked={channel === option} onChange={() => { setChannel(option); touch("channel"); }} />
                  <Icon size={16} aria-hidden="true" />
                  <span>{t(`channels.${option}`)}</span>
                </label>
              );
            })}
          </fieldset>

          <div className="ls-contact-row">
            <label className={`ls-contact-field${ai("contactedAt")}`}>
              <span className="referral-label">{t("formDate")}</span>
              <input type="datetime-local" value={contactedAt} max={toLocalInput(new Date())} onChange={(event) => { setContactedAt(event.target.value); touch("contactedAt"); }} required disabled={busy} />
            </label>
            <label className={`ls-contact-field${ai("status")}`}>
              <span className="referral-label">{t("formStatus")}</span>
              <select value={status} onChange={(event) => { setStatus(event.target.value as ContactStatus); touch("status"); }} disabled={busy}>
                {CONTACT_STATUSES.map((option) => <option key={option} value={option}>{t(`statuses.${option}`)}</option>)}
              </select>
            </label>
          </div>

          <label className={`ls-contact-field${ai("message")}`}>
            <span className="referral-label">{t("formMessage")} <span className="ls-muted">{t("formOptional")}</span></span>
            <textarea value={message} onChange={(event) => { setMessage(event.target.value); touch("message"); }} rows={3} maxLength={4000} placeholder={t("formMessagePlaceholder")} disabled={busy} />
          </label>
          <label className={`ls-contact-field${ai("notes")}`}>
            <span className="referral-label">{t("formNotes")} <span className="ls-muted">{t("formOptional")}</span></span>
            <textarea value={notes} onChange={(event) => { setNotes(event.target.value); touch("notes"); }} rows={2} maxLength={2000} placeholder={t("formNotesPlaceholder")} disabled={busy} />
          </label>


          {status === "meeting" && (
            <fieldset className="ls-contact-calendar" disabled={busy || Boolean(savedWithWarning)}>
              <legend className="referral-label"><CalendarPlus size={14} aria-hidden="true" /> {t("calendarTitle")}</legend>
              {calendarReady === false ? (
                <div className="ls-contact-calendar-connect">
                  <p className="ls-muted">{t("calendarConnectHint")}</p>
                  <GoogleFeatureConnectButton feature="calendar" returnTo="/integraciones" />
                </div>
              ) : calendarReady === null ? (
                <p className="ls-muted"><LoaderCircle className="referral-spin" size={14} aria-hidden="true" /> {t("calendarChecking")}</p>
              ) : (
                <>
                  <label className="ls-contact-check">
                    <input type="checkbox" checked={schedule} onChange={(event) => { setSchedule(event.target.checked); if (event.target.checked && !meetingAt) { const next = new Date(); next.setDate(next.getDate() + 1); next.setHours(10, 0, 0, 0); setMeetingAt(toLocalInput(next)); } }} />
                    <span>{t("calendarSchedule")}</span>
                  </label>
                  {schedule && (
                    <>
                      <div className="ls-contact-row">
                        <label className="ls-contact-field">
                          <span className="referral-label">{t("calendarStart")}</span>
                          <input type="datetime-local" value={meetingAt} min={toLocalInput(new Date())} onChange={(event) => setMeetingAt(event.target.value)} required />
                        </label>
                        <label className="ls-contact-field">
                          <span className="referral-label">{t("calendarDuration")}</span>
                          <select value={meetingMinutes} onChange={(event) => setMeetingMinutes(Number(event.target.value))}>
                            {MEETING_MINUTES.map((minutes) => <option key={minutes} value={minutes}>{t("calendarMinutes", { minutes })}</option>)}
                          </select>
                        </label>
                      </div>
                      <label className="ls-contact-check"><input type="checkbox" checked={invite} onChange={(event) => setInvite(event.target.checked)} /><span>{t("calendarInvite")}</span></label>
                      <label className="ls-contact-check"><input type="checkbox" checked={meetLink} onChange={(event) => setMeetLink(event.target.checked)} /><span>{t("calendarMeet")}</span></label>
                    </>
                  )}
                </>
              )}
            </fieldset>
          )}

          <p className="referral-status" role={error ? "alert" : undefined}>{error}</p>
          <div className="ls-contact-actions">
            <button type="button" className="auth-secondary-button ls-button" onClick={close} disabled={busy}>{t("formCancel")}</button>
            {savedWithWarning ? (
              <button type="button" className="primary-button ls-contact-submit" onClick={() => onSaved(savedWithWarning)}>{t("calendarSavedClose")}</button>
            ) : (
              <button type="submit" className="primary-button ls-contact-submit" disabled={busy}>
                {saving && <LoaderCircle className="referral-spin" size={16} aria-hidden="true" />}
                {saving ? t("formSaving") : editing ? t("formSaveChanges") : t("formSave")}
              </button>
            )}
          </div>
        </form>
      )}
    </dialog>
  );
}

/** Resultado de borrar contactos: ids borrados y leads con estado/último contacto recalculados. */
export type DeleteResult = { deleted: string[]; leads: LeadMatch[] };

async function deleteContacts(ids: string[], fallbackError: string): Promise<DeleteResult> {
  const single = ids.length === 1;
  const response = await fetch(single ? `/api/lead-suite/contacts/${encodeURIComponent(ids[0])}` : "/api/lead-suite/contacts", {
    method: "DELETE",
    ...(single ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) }),
  });
  const body = await response.json().catch(() => null) as { contact?: LeadContact; lead?: LeadMatch; deleted?: string[]; leads?: LeadMatch[]; error?: string } | null;
  if (!response.ok || !body) throw new Error(body?.error || fallbackError);
  if (single) return { deleted: ids, leads: body.lead ? [body.lead] : [] };
  return { deleted: body.deleted ?? ids, leads: body.leads ?? [] };
}

/**
 * Contactos registrados con todos sus datos. Acciones compactas por contacto (editar / eliminar con confirmación corta)
 * y selección múltiple con "Seleccionar todos" y "Eliminar (N)" con una sola confirmación, como la tabla de /buscar.
 */
export function ContactList({ contacts, showLead, onEdit, onDeleted }: { contacts: LeadContact[]; showLead?: boolean; onEdit: (contact: LeadContact) => void; onDeleted: (result: DeleteResult) => void }) {
  const t = useTranslations("leadSuite");
  const format = useFormatter();
  const uid = useId();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState<{ ids: string[]; bulk: boolean } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  // La selección solo cuenta contactos que siguen en la lista (tras un refresco pueden haber cambiado).
  const visible = contacts.filter((contact) => selected.has(contact.id)).map((contact) => contact.id);
  const allSelected = contacts.length > 0 && visible.length === contacts.length;
  const bulkPending = pending?.bulk ? pending.ids : null;

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function confirmDelete(ids: string[]) {
    setDeleting(true);
    setError("");
    try {
      const result = await deleteContacts(ids, t("deleteError"));
      setSelected((current) => new Set([...current].filter((id) => !result.deleted.includes(id))));
      setPending(null);
      onDeleted(result);
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : t("deleteError"));
    } finally {
      setDeleting(false);
    }
  }

  if (!contacts.length) return null;

  return (
    <div className="ls-contacts">
      <div
        className={`ls-contacts-bar${visible.length ? " has-selection" : ""}`}
        role={bulkPending ? "alertdialog" : "region"}
        aria-label={bulkPending ? t("deleteManyConfirm", { count: bulkPending.length }) : t("selectionAria")}
        onKeyDown={(event) => { if (event.key === "Escape" && bulkPending) setPending(null); }}
      >
        {bulkPending ? (
          <>
            <span className="ls-contacts-bar-text">{t("deleteManyConfirm", { count: bulkPending.length })}</span>
            <div className="ls-contacts-bar-actions">
              <button type="button" className="auth-secondary-button ls-button" autoFocus onClick={() => setPending(null)} disabled={deleting}>{t("formCancel")}</button>
              <button type="button" className="danger-button ls-contacts-delete" onClick={() => void confirmDelete(bulkPending)} disabled={deleting}>
                {deleting ? <LoaderCircle className="referral-spin" size={14} aria-hidden="true" /> : <Trash2 size={14} aria-hidden="true" />}{t("delete")}
              </button>
            </div>
          </>
        ) : (
          <>
            <label className="ls-contacts-all">
              <input type="checkbox" checked={allSelected} ref={(node) => { if (node) node.indeterminate = visible.length > 0 && !allSelected; }} onChange={() => setSelected(allSelected ? new Set() : new Set(contacts.map((contact) => contact.id)))} />
              <span>{visible.length ? t("selectedContacts", { count: visible.length }) : t("selectAll")}</span>
            </label>
            {visible.length > 0 && (
              <div className="ls-contacts-bar-actions">
                <button type="button" className="auth-secondary-button ls-button" onClick={() => setSelected(new Set())}>{t("clearSelection")}</button>
                <button type="button" className="danger-button ls-contacts-delete" onClick={() => setPending({ ids: visible, bulk: true })}>
                  <Trash2 size={14} aria-hidden="true" />{t("deleteSelected", { count: visible.length })}
                </button>
              </div>
            )}
          </>
        )}
      </div>
      {error && <p role="alert" className="ls-contact-item-error">{error}</p>}

      <ul className="ls-contact-items">
        {contacts.map((contact) => {
          const Icon = channelIcons[contact.channel] ?? Ellipsis;
          const checked = selected.has(contact.id);
          const confirming = !pending?.bulk && pending?.ids[0] === contact.id;
          const when = format.dateTime(new Date(contact.contactedAt), { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
          return (
            <li key={contact.id} className={`ls-contact-item${checked ? " is-selected" : ""}`}>
              <input type="checkbox" className="ls-contact-item-check" checked={checked} onChange={() => toggle(contact.id)} aria-label={t("selectContactAria", { name: contact.leadName, date: when })} id={`${uid}-${contact.id}`} />
              <div className="ls-contact-item-body">
                <div className="ls-contact-item-head">
                  <span className="ls-contact-item-channel"><Icon size={15} aria-hidden="true" />{showLead ? contact.leadName : t(`channels.${contact.channel}`)}</span>
                  <span className="ls-chip" data-status={contact.status}>{t(`statuses.${contact.status}`)}</span>
                  <div className="ls-contact-item-icons">
                    <button type="button" className="ls-icon-action" onClick={() => onEdit(contact)} aria-label={t("editContactAria", { name: contact.leadName })} title={t("edit")}><Pencil size={15} aria-hidden="true" /></button>
                    <button type="button" className="ls-icon-action is-danger" onClick={() => setPending({ ids: [contact.id], bulk: false })} aria-label={t("deleteContactAria", { name: contact.leadName })} title={t("delete")}><Trash2 size={15} aria-hidden="true" /></button>
                  </div>
                </div>
                <time className="ls-muted" dateTime={contact.contactedAt}>{showLead ? `${t(`channels.${contact.channel}`)} · ` : ""}{when}</time>
                {contact.message && <p className="ls-contact-item-text"><span className="ls-sr">{t("formMessage")}: </span>{contact.message}</p>}
                {(() => {
                  const { event, meet, rest } = meetingLinks(contact.notes ?? "");
                  return (
                    <>
                      {rest && <p className="ls-contact-item-notes"><span>{t("formNotes")}:</span> {rest}</p>}
                      {(event || meet) && (
                        <p className="ls-contact-item-links">
                          {event && <a href={event} target="_blank" rel="noreferrer"><CalendarPlus size={14} aria-hidden="true" />{t("calendarOpenEvent")}<ExternalLink size={12} aria-hidden="true" /></a>}
                          {meet && <a href={meet} target="_blank" rel="noreferrer"><Video size={14} aria-hidden="true" />{t("calendarOpenMeet")}<ExternalLink size={12} aria-hidden="true" /></a>}
                        </p>
                      )}
                    </>
                  );
                })()}
                {confirming && (
                  <div className="ls-contact-item-confirm" role="alertdialog" aria-label={t("deleteConfirmShort")} onKeyDown={(event) => { if (event.key === "Escape") setPending(null); }}>
                    <span>{t("deleteConfirmShort")}</span>
                    <button type="button" className="ls-text-action" autoFocus onClick={() => setPending(null)} disabled={deleting}>{t("formCancel")}</button>
                    <button type="button" className="ls-text-action is-danger" onClick={() => void confirmDelete([contact.id])} disabled={deleting}>
                      {deleting ? <LoaderCircle className="referral-spin" size={13} aria-hidden="true" /> : null}{t("delete")}
                    </button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
