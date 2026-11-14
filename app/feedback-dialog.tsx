"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Bug, CheckCircle2, LoaderCircle, MessageSquare, X } from "lucide-react";
import { errorReportEnabled, openErrorReport, type ErrorReportContext, type FeedbackPrefill } from "./error-report";
import "./referral-dialog.css";
import "./feedback-dialog.css";

// Últimos errores de la página, para adjuntarlos al reporte. Se registra una sola vez por pestaña.
const recentErrors: string[] = [];
const pageLoadedAt = new Date().toISOString();
if (typeof window !== "undefined") {
  const push = (value: string) => {
    recentErrors.push(`${new Date().toISOString()} ${value}`.slice(0, 400));
    if (recentErrors.length > 10) recentErrors.shift();
  };
  window.addEventListener("error", (event) => push(`${event.message} @ ${event.filename}:${event.lineno}:${event.colno}`));
  window.addEventListener("unhandledrejection", (event) => push(`unhandledrejection: ${event.reason instanceof Error ? event.reason.message : String(event.reason)}`));
}

function browserContext() {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { effectiveType?: string } };
  return {
    url: location.href,
    referrer: document.referrer,
    viewport: `${innerWidth}x${innerHeight}`,
    screen: `${screen.width}x${screen.height}`,
    devicePixelRatio: String(devicePixelRatio),
    language: nav.language,
    languages: nav.languages?.join(", ") ?? "",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    platform: nav.platform,
    online: String(nav.onLine),
    colorScheme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
    memory: nav.deviceMemory ? `${nav.deviceMemory} GB` : "",
    connection: nav.connection?.effectiveType ?? "",
    pageLoadedAt,
    recentErrors,
  };
}

/** Modal nativo <dialog> para mandar un comentario o reportar un error. */
export function FeedbackDialog({ open, onClose, prefill }: { open: boolean; onClose: () => void; prefill?: FeedbackPrefill | null }) {
  const t = useTranslations("Feedback");
  const locale = useLocale();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [kind, setKind] = useState<"comment" | "bug">("comment");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");
  const [appliedPrefill, setAppliedPrefill] = useState<FeedbackPrefill | null | undefined>(null);

  // Precarga desde un reporte de error: se aplica una vez por objeto recibido.
  if (prefill && prefill !== appliedPrefill) {
    setAppliedPrefill(prefill);
    setKind(prefill.kind);
    setMessage(prefill.message);
    setStatus("idle");
    setError("");
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function handleClose() {
    onClose();
    if (status === "sent") {
      setStatus("idle");
      setMessage("");
      setKind("comment");
    }
    setError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (message.trim().length < 5) {
      setError(t("tooShort"));
      return;
    }
    setStatus("sending");
    setError("");
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, message, locale, context: browserContext() }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(data.error || t("failed"));
      setStatus("sent");
    } catch (caught) {
      setStatus("idle");
      setError(caught instanceof Error && caught.message ? caught.message : t("failed"));
    }
  }

  const sending = status === "sending";

  return (
    <dialog ref={dialogRef} className="referral-dialog feedback-dialog" aria-labelledby="feedback-title" onClose={handleClose} onClick={(event) => { if (event.target === event.currentTarget) handleClose(); }}>
      <div className="referral-body">
        <div className="referral-head">
          <span className="referral-icon" aria-hidden="true"><MessageSquare size={18} strokeWidth={1.8} /></span>
          <h2 id="feedback-title">{t("title")}<span className="brand-dot" aria-hidden="true">.</span></h2>
          <button type="button" className="referral-close" onClick={handleClose} aria-label={t("close")}><X size={18} aria-hidden="true" /></button>
        </div>
        {status === "sent" ? (
          <div className="feedback-sent" role="status">
            <CheckCircle2 size={22} strokeWidth={1.8} aria-hidden="true" />
            <p>{t("sent")}</p>
            <button type="button" className="primary-button" onClick={handleClose}>{t("done")}</button>
          </div>
        ) : (
          <form className="feedback-form" onSubmit={submit} noValidate>
            <p className="referral-intro">{t("intro")}</p>
            <fieldset className="feedback-kind">
              <legend className="referral-label">{t("kindLabel")}</legend>
              <label className="feedback-kind-option">
                <input type="radio" name="feedback-kind" value="comment" checked={kind === "comment"} onChange={() => setKind("comment")} disabled={sending} />
                <MessageSquare size={16} strokeWidth={1.8} aria-hidden="true" /> {t("kindComment")}
              </label>
              <label className="feedback-kind-option">
                <input type="radio" name="feedback-kind" value="bug" checked={kind === "bug"} onChange={() => setKind("bug")} disabled={sending} />
                <Bug size={16} strokeWidth={1.8} aria-hidden="true" /> {t("kindBug")}
              </label>
            </fieldset>
            <label className="feedback-message">
              <span className="referral-label">{kind === "bug" ? t("messageLabelBug") : t("messageLabel")}</span>
              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder={kind === "bug" ? t("placeholderBug") : t("placeholder")}
                rows={5}
                maxLength={4000}
                required
                disabled={sending}
                aria-invalid={Boolean(error) || undefined}
                aria-describedby="feedback-hint"
              />
            </label>
            <p className="referral-status" id="feedback-hint" role={error ? "alert" : undefined}>{error || t("hint")}</p>
            <button type="submit" className="primary-button feedback-submit" disabled={sending}>
              {sending && <LoaderCircle className="referral-spin" size={16} aria-hidden="true" />}
              {sending ? t("sending") : t("send")}
            </button>
          </form>
        )}
      </div>
    </dialog>
  );
}

/** Botón "Enviar reporte" junto a un error visible; solo en producción. */
export function ErrorReportButton({ className = "error-report-button", ...context }: ErrorReportContext & { className?: string }) {
  const t = useTranslations("Search");
  if (!errorReportEnabled || !context.message) return null;
  return (
    <button type="button" className={className} aria-haspopup="dialog" onClick={() => openErrorReport(context)}>
      <Bug size={14} aria-hidden="true" /> {t("sendErrorReport")}
    </button>
  );
}
