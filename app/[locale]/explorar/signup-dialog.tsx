"use client";

import { useEffect, useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Gift, Lock, X } from "lucide-react";
import { AuthForm } from "@/app/auth-form";
import { afterAuthPath } from "@/app/auth-page";
import "@/app/modal-dialog.css";

/** Se abre al intentar enviar una propuesta: el envío exige cuenta. */
export function SignupDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations("Explore.signup");
  const tExplore = useTranslations("Explore");
  const locale = useLocale();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // Next deja la página anterior montada y oculta: un modal abierto seguiría bloqueando los clics de la página nueva.
  useEffect(() => {
    const dialog = dialogRef.current;
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="modal-dialog w-[min(460px,calc(100vw-32px))]!"
      aria-labelledby="explore-signup-title"
      aria-describedby="explore-signup-text"
      onClose={onClose}
      // Backdrop o link: un link navega y el modal no debe quedar abierto en la página oculta.
      onClick={(event) => { if (event.target === event.currentTarget || (event.target as Element).closest("a")) dialogRef.current?.close(); }}
    >
      <div className="modal-body">
        <div className="modal-head">
          <span className="modal-icon" aria-hidden="true"><Lock size={18} /></span>
          <h2 id="explore-signup-title">{t("title")}</h2>
          <button type="button" className="modal-close" onClick={() => dialogRef.current?.close()} aria-label={t("close")}><X size={18} aria-hidden="true" /></button>
        </div>
        <p id="explore-signup-text" className="mb-4 flex items-center gap-2 text-sm font-semibold text-(color:--ink)">
          <Gift size={16} className="shrink-0" aria-hidden="true" />{tExplore("trial")}
        </p>
        {/* Registro completo acá mismo: Google arriba, después email, teléfono y contraseña. Solo se monta abierto (Turnstile). */}
        {open ? <AuthForm embedded initialMode="register" onAuthenticated={() => void afterAuthPath(locale).then((path) => window.location.assign(path))} /> : null}
      </div>
    </dialog>
  );
}
