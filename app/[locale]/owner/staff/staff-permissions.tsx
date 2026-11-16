"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { Check, ChevronDown, FastForward, ShieldAlert, ShieldCheck } from "lucide-react";
import { Popover } from "@/app/ui/popover";
import "@/app/auth-steps.css";
import "@/app/modal-dialog.css";

export type StaffPermission = "ask" | "skip" | "danger";

// Own key: the owner's Staff choice never changes (or is changed by) their user Leadtita permission.
const KEY = "leadta:staff-permission";
const OPTIONS: StaffPermission[] = ["skip", "ask", "danger"];
const ICONS = { ask: ShieldCheck, skip: FastForward, danger: ShieldAlert } as const;

// "Peligro" lives only in memory and always shows its warning: a reload falls back to the last safe choice.
let memory: StaffPermission | null = null;
const listeners = new Set<() => void>();
function read(): StaffPermission {
  if (memory) return memory;
  try { return localStorage.getItem(KEY) === "skip" ? "skip" : "ask"; } catch { return "ask"; }
}
function write(value: StaffPermission) {
  memory = value;
  if (value !== "danger") try { localStorage.setItem(KEY, value); } catch { /* storage blocked: memory keeps it for this tab */ }
  listeners.forEach((listener) => listener());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export const useStaffPermission = () => useSyncExternalStore(subscribe, read, () => "ask" as const);

/** Client side of the rule the confirm endpoint re-checks: `needsCard` comes from the server's signed proposal. */
export function runsWithoutAsking(permission: StaffPermission, needsCard: boolean) {
  return permission === "danger" || (permission === "skip" && !needsCard);
}

export function StaffPermissionControl({ onResumeTyping }: { onResumeTyping: () => void }) {
  const t = useTranslations("ownerAssistant.permissions");
  const permission = useStaffPermission();
  const [open, setOpen] = useState(false);
  const [warning, setWarning] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const Icon = ICONS[permission];

  useEffect(() => {
    if (warning && dialogRef.current && !dialogRef.current.open) dialogRef.current.showModal();
  }, [warning]);

  const choose = (value: StaffPermission) => {
    setOpen(false);
    if (value === "danger" && permission !== "danger") {
      setWarning(true);
      return;
    }
    write(value);
    window.setTimeout(onResumeTyping, 0);
  };

  const activateDanger = () => {
    write("danger");
    dialogRef.current?.close();
  };

  return (
    <div className="ls-chat__control-wrap">
      <button ref={anchor} type="button" className={`ls-chat__control ls-chat__control--permission is-${permission}${open ? " is-open" : ""}`} onClick={() => setOpen((value) => !value)} aria-haspopup="menu" aria-expanded={open}>
        <Icon className="ls-chat__control-icon" size={15} aria-hidden="true" /><span>{t("label")}</span><span className="ls-chat__control-current">{t(`options.${permission}`)}</span><ChevronDown size={13} aria-hidden="true" />
      </button>
      {open && (
        <Popover open onClose={() => setOpen(false)} anchorRef={anchor} role="menu" placement="top-start" offset={8} className="ls-chat__mode-menu" aria-label={t("label")}>
          <div className="ls-chat__mode-head"><strong>{t("title")}</strong><span>{t("help")}</span></div>
          <div className="ls-chat__mode-options" role="group" aria-label={t("label")}>
            {OPTIONS.map((value) => {
              const OptionIcon = ICONS[value];
              return (
                <button key={value} type="button" role="menuitem" aria-current={permission === value ? "true" : undefined} className={`ls-chat__mode-option is-${value}`} onClick={() => choose(value)}>
                  <span className="ls-chat__mode-option-icon"><OptionIcon size={16} aria-hidden="true" /></span>
                  <span className="ls-chat__mode-option-copy"><strong>{t(`options.${value}`)}</strong><small>{t(`hints.${value}`)}</small></span>
                  {permission === value ? <Check className="ls-chat__mode-check" size={16} aria-hidden="true" /> : null}
                </button>
              );
            })}
          </div>
        </Popover>
      )}
      {warning && (
        <dialog ref={dialogRef} className="modal-dialog" aria-labelledby="staff-danger-title" aria-describedby="staff-danger-text" onClose={() => { setWarning(false); onResumeTyping(); }} onClick={(event) => { if (event.target === event.currentTarget) dialogRef.current?.close(); }}>
          <div className="modal-body">
            <header className="modal-head">
              <span className="modal-icon ls-danger__icon" aria-hidden="true"><ShieldAlert size={20} /></span>
              <h2 id="staff-danger-title">{t("danger.title")}</h2>
            </header>
            <p id="staff-danger-text" className="modal-intro">{t("danger.intro")}</p>
            <ul className="ls-danger__risks">
              <li>{t("danger.risk1")}</li>
              <li>{t("danger.risk2")}</li>
              <li>{t("danger.risk3")}</li>
            </ul>
            <div className="ls-danger__actions">
              <button type="button" className="auth-secondary-button" onClick={() => dialogRef.current?.close()}>{t("danger.cancel")}</button>
              <button type="button" className="primary-button ls-danger__confirm" onClick={activateDanger}><ShieldAlert size={16} aria-hidden="true" /><span>{t("danger.confirm")}</span></button>
            </div>
          </div>
        </dialog>
      )}
    </div>
  );
}
