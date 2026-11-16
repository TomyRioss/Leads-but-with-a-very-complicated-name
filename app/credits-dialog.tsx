"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Stars, X } from "lucide-react";
import { FaWhatsapp } from "react-icons/fa";
import "./modal-dialog.css";
import "./credits-dialog.css";

const SALES_WHATSAPP = "5491134083140";

/** Custom-plan modal opened from the sidebar credits pill: plans are tailored, so the CTA goes to sales on WhatsApp. */
export function CreditsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations("CreditsPlans");
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const href = `https://wa.me/${SALES_WHATSAPP}?text=${encodeURIComponent(t("whatsappMessage"))}`;

  return (
    <dialog ref={dialogRef} className="modal-dialog" aria-labelledby="credits-plans-title" aria-describedby="credits-plans-text" onClose={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal-body">
        <header className="modal-head">
          <span className="modal-icon" aria-hidden="true"><Stars size={20} /></span>
          <h2 id="credits-plans-title">{t("title")}</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label={t("close")}><X size={18} aria-hidden="true" /></button>
        </header>
        <p className="credits-plans-price"><span>{t("from")}</span> <strong>{t("price")}</strong></p>
        <p id="credits-plans-text" className="modal-intro">{t("text")}</p>
        <a className="primary-button credits-plans-cta" href={href} target="_blank" rel="noopener noreferrer" onClick={onClose}>
          <FaWhatsapp size={17} aria-hidden="true" /><span>{t("cta")}</span>
        </a>
        <p className="credits-plans-phone">{t("phone")}</p>
      </div>
    </dialog>
  );
}
