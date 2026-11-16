"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Mail, MessageCircle, Sparkles, X } from "lucide-react";
import { Link } from "@/i18n/navigation";
import "./auth-steps.css";
import "./modal-dialog.css";
import "./whats-new-dialog.css";

// ponytail: "seen" lives in localStorage per email; another browser/device shows it once more.
const storageKey = (email: string) => `leadta:whatsNew:whatsapp-gmail:${email.toLowerCase()}`;

function seen(email: string) {
  try { return localStorage.getItem(storageKey(email)) !== null; } catch { return true; }
}
function markSeen(email: string) {
  try { localStorage.setItem(storageKey(email), "1"); } catch { /* storage blocked */ }
}

/** One-time WhatsApp + Gmail announcement. Marked seen on close, so a redirect before dismissal shows it again later. */
export function WhatsNewDialog({ email }: { email: string | null }) {
  const t = useTranslations("WhatsNew");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [shownFor, setShownFor] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads localStorage once the session email is known
    if (email && !seen(email)) setShownFor(email);
  }, [email]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (shownFor && dialog && !dialog.open) dialog.showModal();
  }, [shownFor]);

  if (!shownFor || shownFor !== email) return null;
  const close = () => dialogRef.current?.close();

  return (
    <dialog ref={dialogRef} className="modal-dialog" aria-labelledby="whats-new-title" aria-describedby="whats-new-text" onClose={() => { markSeen(shownFor); setShownFor(null); }} onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
      <div className="modal-body">
        <header className="modal-head">
          <span className="modal-icon" aria-hidden="true"><Sparkles size={20} /></span>
          <h2 id="whats-new-title">{t("title")}</h2>
          <button type="button" className="modal-close" onClick={close} aria-label={t("close")}><X size={18} aria-hidden="true" /></button>
        </header>
        <p id="whats-new-text" className="modal-intro">{t("text")}</p>
        <ul className="whats-new-points">
          <li><MessageCircle size={16} aria-hidden="true" /><span>{t("whatsapp")}</span></li>
          <li><Mail size={16} aria-hidden="true" /><span>{t("gmail")}</span></li>
        </ul>
        <div className="whats-new-actions">
          <button type="button" className="auth-secondary-button" onClick={close}>{t("later")}</button>
          <Link className="primary-button whats-new-cta" href="/leadtita" onClick={close}>
            <Sparkles size={16} aria-hidden="true" /><span>{t("cta")}</span>
          </Link>
        </div>
      </div>
    </dialog>
  );
}
