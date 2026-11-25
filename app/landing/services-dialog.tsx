"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Briefcase, Loader2, X } from "lucide-react";
import type { ExploreInput } from "@/lib/explore/types";
import "../modal-dialog.css";

const MAX = 300;
const fieldClass =
  "w-full rounded-[10px] border border-(--line) bg-(--paper) px-3 py-2.5 text-[15px] leading-normal text-(color:--ink) placeholder:text-(color:--ash-500) outline-none transition-colors focus-visible:border-(--ink) focus-visible:shadow-[0_0_0_1px_var(--ink)] disabled:opacity-60";

type ServicesInput = Extract<ExploreInput, { mode: "services" }>;

/** Modal nativo para el modo "Vendo servicios" del flujo /explorar. */
export function ServicesDialog({ open, onClose, onSubmit, busy, error }: {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: ServicesInput) => void;
  busy: boolean;
  error: ReactNode;
}) {
  const t = useTranslations("Landing.hero.explore.dialog");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [offer, setOffer] = useState("");
  const [idealCustomer, setIdealCustomer] = useState("");
  const [markets, setMarkets] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const ready = Boolean(offer.trim() && idealCustomer.trim() && markets.trim());

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || busy) return;
    onSubmit({ mode: "services", offer: offer.trim(), idealCustomer: idealCustomer.trim(), markets: markets.trim() });
  }

  return (
    <dialog
      ref={dialogRef}
      className="modal-dialog w-[min(500px,calc(100vw-32px))]! text-left"
      aria-labelledby="explore-services-title"
      aria-describedby="explore-services-subtitle"
      onClose={onClose}
      onCancel={(event) => { if (busy) event.preventDefault(); }}
      onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}
    >
      <form className="modal-body" onSubmit={submit}>
        <div className="modal-head">
          <span className="modal-icon" aria-hidden="true"><Briefcase size={18} strokeWidth={1.8} /></span>
          <h2 id="explore-services-title" className="text-[21px]! font-[650]! leading-[1.15]! tracking-[-0.03em]!">{t("title")}</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label={t("close")}><X size={18} aria-hidden="true" /></button>
        </div>
        <p id="explore-services-subtitle" className="modal-intro">{t("subtitle")}</p>
        <label className="grid gap-1.5">
          <span className="modal-label">{t("offerLabel")}</span>
          <textarea className={`${fieldClass} resize-none`} rows={3} maxLength={MAX} required disabled={busy} value={offer} onChange={(event) => setOffer(event.target.value)} placeholder={t("offerPlaceholder")} />
        </label>
        <label className="grid gap-1.5">
          <span className="modal-label">{t("customerLabel")}</span>
          <textarea className={`${fieldClass} resize-none`} rows={3} maxLength={MAX} required disabled={busy} value={idealCustomer} onChange={(event) => setIdealCustomer(event.target.value)} placeholder={t("customerPlaceholder")} />
        </label>
        <label className="grid gap-1.5">
          <span className="modal-label">{t("marketsLabel")}</span>
          <input className={fieldClass} type="text" maxLength={MAX} required disabled={busy} value={markets} onChange={(event) => setMarkets(event.target.value)} placeholder={t("marketsPlaceholder")} />
        </label>
        {error ? <p className="m-0 text-[13px] leading-normal text-(color:--ash-800)" role="alert">{error}</p> : null}
        <button type="submit" className="lp-btn lp-btn-ink w-full disabled:cursor-not-allowed disabled:opacity-50" disabled={!ready || busy}>
          {busy && <Loader2 className="animate-spin motion-reduce:animate-none" size={16} aria-hidden="true" />}
          {t("submit")}
        </button>
      </form>
    </dialog>
  );
}
