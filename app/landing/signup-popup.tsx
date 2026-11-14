"use client";

import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowRight, X } from "lucide-react";
import { FcGoogle } from "react-icons/fc";
import { Link, useRouter } from "@/i18n/navigation";
import { getSession } from "@/lib/client/session";
import "./signup-popup.css";

// ponytail: mismo valor que signupCredits en app/api/auth/{register,google/callback}; son server-only y no exportan.
const WELCOME_CREDITS = 240;
const WELCOME_LEADS = WELCOME_CREDITS / 2; // 2 créditos por lead
const SEEN_KEY = "leadta:signup-popup-seen";
/** Lo lee el formulario de registro para precargar el email. */
export const SIGNUP_EMAIL_KEY = "leadta:signup-email";
const DELAY_MS = 4000;
let seenThisTab = false; // respaldo si el storage no está disponible

function alreadySeen() {
  if (seenThisTab) return true;
  try {
    return localStorage.getItem(SEEN_KEY) === "1" || sessionStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function markSeen() {
  seenThisTab = true;
  try { localStorage.setItem(SEEN_KEY, "1"); } catch {
    try { sessionStorage.setItem(SEEN_KEY, "1"); } catch { /* respaldo en memoria */ }
  }
}

export function SignupPopup() {
  const t = useTranslations("Landing.signupPopup");
  const legal = useTranslations("Legal");
  const locale = useLocale();
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");

  useEffect(() => {
    if (alreadySeen()) return;
    let cancelled = false;
    let timer = 0;
    const trigger = () => {
      window.clearTimeout(timer);
      window.removeEventListener("scroll", trigger);
      if (cancelled || alreadySeen()) return;
      // Sin sesión: recién ahí se marca como visto y se abre.
      getSession().then((result) => {
        if (cancelled || result.user) return;
        markSeen();
        setOpen(true);
      }, () => {});
    };
    timer = window.setTimeout(trigger, DELAY_MS);
    window.addEventListener("scroll", trigger, { passive: true, once: true });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener("scroll", trigger);
    };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && dialog && !dialog.open) dialog.showModal();
  }, [open]);

  function close() {
    dialogRef.current?.close();
  }

  function onBackdrop(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === event.currentTarget) close();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = email.trim().toLowerCase();
    try { sessionStorage.setItem(SIGNUP_EMAIL_KEY, value); } catch { /* el formulario queda vacío */ }
    close();
    router.push("/buscar?signup=1");
  }

  if (!open) return null;

  return (
    <dialog ref={dialogRef} className="lp-signup" aria-labelledby="lp-signup-title" aria-describedby="lp-signup-text" onClose={() => setOpen(false)} onClick={onBackdrop}>
      <div className="lp-signup-card">
        <button className="lp-signup-close" type="button" onClick={close} aria-label={t("close")}><X size={18} aria-hidden="true" /></button>
        <div className="lp-signup-hero" aria-hidden="true">
          {/* Mismo logo que BrandLogo (header/footer) sin el Link: el hero es decorativo. */}
          <span className="brand lp-signup-logo">Leadta<span className="brand-period">.</span></span>
        </div>
        <h2 id="lp-signup-title">{t("title")}</h2>
        <p id="lp-signup-text" className="lp-signup-text">
          {t.rich("text", { leads: WELCOME_LEADS, strong: (chunks) => <strong>{chunks}</strong> })}
        </p>
        <a className="lp-signup-google" href={`/api/auth/google?locale=${locale}`}>
          <FcGoogle size={18} aria-hidden="true" /><span>{t("google")}</span>
        </a>
        <div className="lp-signup-divider"><span>{t("or")}</span></div>
        <form className="lp-signup-form" onSubmit={submit}>
          <label className="lp-signup-field">
            <span className="lp-signup-label">{t("emailLabel")}</span>
            <input type="email" autoComplete="email" inputMode="email" required maxLength={254} placeholder={t("emailPlaceholder")} value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <button className="lp-signup-submit" type="submit">{t("submit", { leads: WELCOME_LEADS })} <ArrowRight size={17} aria-hidden="true" /></button>
        </form>
        <p className="lp-signup-note">{t("noCard")}</p>
        <p className="lp-signup-legal">{legal.rich("popup", { terms: (chunks) => <Link href="/terminos">{chunks}</Link>, privacy: (chunks) => <Link href="/privacidad">{chunks}</Link> })}</p>
      </div>
    </dialog>
  );
}
