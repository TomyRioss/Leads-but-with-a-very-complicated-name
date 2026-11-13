"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Copy, Gift, LoaderCircle, Mail, MessageCircle, X } from "lucide-react";
import "./referral-dialog.css";

type Summary = { code: string; link: string; invited: number; rewarded: number; creditsEarned: number };

/** Modal built on the native <dialog>: focus trap, Escape and inert background come from the platform. */
export function ReferralDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations("Referral");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open || summary) return;
    const controller = new AbortController();
    fetch("/api/referrals?page=1", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("referrals");
        setSummary(await response.json() as Summary);
        setFailed(false);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setFailed(true);
      });
    return () => controller.abort();
  }, [open, summary]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    if (!summary) return;
    try {
      await navigator.clipboard.writeText(summary.link);
      setCopied(true);
    } catch {
      document.getElementById("referral-link")?.focus();
    }
  }

  const shareText = summary ? `${t("shareMessage")} ${summary.link}` : "";

  return (
    <dialog ref={dialogRef} className="referral-dialog" aria-labelledby="referral-title" onClose={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="referral-body">
        <header className="referral-head">
          <span className="referral-icon" aria-hidden="true"><Gift size={20} /></span>
          <h2 id="referral-title">{t("title")}</h2>
          <button type="button" className="referral-close" onClick={onClose} aria-label={t("close")}><X size={18} aria-hidden="true" /></button>
        </header>
        <p className="referral-intro">{t("intro", { referrer: 50, referred: 25 })}</p>
        {failed ? (
          <p className="referral-error" role="alert">{t("loadFailed")}</p>
        ) : !summary ? (
          <p className="referral-loading" role="status"><LoaderCircle className="referral-spin" size={16} aria-hidden="true" />{t("loading")}</p>
        ) : (
          <>
            <label className="referral-label" htmlFor="referral-link">{t("yourLink")}</label>
            <div className="referral-link-row">
              <input id="referral-link" readOnly value={summary.link} onFocus={(event) => event.currentTarget.select()} />
              <button type="button" className="primary-button referral-copy" onClick={() => void copy()}>
                {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
                <span>{copied ? t("copied") : t("copy")}</span>
              </button>
            </div>
            <p className="referral-status" role="status">{copied ? t("copiedStatus") : ""}</p>
            <div className="referral-share">
              <a className="auth-secondary-button" href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noopener noreferrer">
                <MessageCircle size={16} aria-hidden="true" /><span>{t("shareWhatsapp")}</span>
              </a>
              <a className="auth-secondary-button" href={`mailto:?subject=${encodeURIComponent(t("emailSubject"))}&body=${encodeURIComponent(shareText)}`}>
                <Mail size={16} aria-hidden="true" /><span>{t("shareEmail")}</span>
              </a>
            </div>
            <dl className="referral-stats">
              <div><dt>{t("invited")}</dt><dd>{summary.invited}</dd></div>
              <div><dt>{t("verified")}</dt><dd>{summary.rewarded}</dd></div>
              <div><dt>{t("creditsEarned")}</dt><dd>{summary.creditsEarned}</dd></div>
            </dl>
          </>
        )}
      </div>
    </dialog>
  );
}
