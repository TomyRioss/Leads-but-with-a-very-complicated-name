"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Plug, X } from "lucide-react";
import { IntegrationsView } from "@/app/[locale]/integraciones/integrations-view";
import "./modal-dialog.css";

export const OPEN_INTEGRATIONS_EVENT = "leadta:open-integrations";

/** Opens the integrations modal from anywhere (e.g. the chat's "+" menu) without prop drilling. */
export function openIntegrations() {
  window.dispatchEvent(new Event(OPEN_INTEGRATIONS_EVENT));
}

/**
 * Integrations as a modal: same cards as /integraciones (kept as the Google OAuth return page and for old links).
 * The cards mount only while open, so their status requests run on demand.
 */
export function IntegrationsDialog({ open, onClose, returnTo = "/integraciones" }: { open: boolean; onClose: () => void; returnTo?: "/integraciones" | "/leadtita" }) {
  const t = useTranslations("integrations");
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={dialogRef} className="modal-dialog integrations-dialog" aria-labelledby="integrations-dialog-title" onClose={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      {open ? (
        <div className="modal-body">
          <header className="modal-head">
            <span className="modal-icon" aria-hidden="true"><Plug size={20} /></span>
            <h2 id="integrations-dialog-title">{t("title")}</h2>
            <button type="button" className="modal-close" onClick={onClose} aria-label={t("dialogClose")}><X size={18} aria-hidden="true" /></button>
          </header>
          <p className="modal-intro">{t("lede")}</p>
          <IntegrationsView returnTo={returnTo} />
        </div>
      ) : null}
    </dialog>
  );
}
