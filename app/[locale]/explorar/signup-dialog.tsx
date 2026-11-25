"use client";

import { useEffect, useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Lock, X } from "lucide-react";
import { FcGoogle } from "react-icons/fc";
import { Link } from "@/i18n/navigation";
import "@/app/modal-dialog.css";

/** Se abre al intentar enviar una propuesta: el envío exige cuenta. */
export function SignupDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations("Explore.signup");
  const locale = useLocale();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="modal-dialog"
      aria-labelledby="explore-signup-title"
      aria-describedby="explore-signup-text"
      onClose={onClose}
      onClick={(event) => { if (event.target === event.currentTarget) dialogRef.current?.close(); }}
    >
      <div className="modal-body">
        <div className="modal-head">
          <span className="modal-icon" aria-hidden="true"><Lock size={18} /></span>
          <h2 id="explore-signup-title">{t("title")}</h2>
          <button type="button" className="modal-close" onClick={() => dialogRef.current?.close()} aria-label={t("close")}><X size={18} aria-hidden="true" /></button>
        </div>
        <p id="explore-signup-text" className="modal-intro">{t("text")}</p>
        <div className="grid gap-2.5">
          <Link href="/register" className="inline-flex min-h-11 items-center justify-center rounded-lg bg-(--lime) px-5 text-sm font-semibold text-(color:--ink) hover:bg-(--lime-dark) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(color:--ink)">{t("create")}</Link>
          <a href={`/api/auth/google?locale=${locale}`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-(color:--line) bg-(--paper) px-5 text-sm font-semibold text-(color:--ink) hover:bg-(--ash-50) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(color:--ink)">
            <FcGoogle size={18} aria-hidden="true" />{t("google")}
          </a>
        </div>
      </div>
    </dialog>
  );
}
