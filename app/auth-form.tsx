"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, CircleCheck, LoaderCircle, Mail, TriangleAlert } from "lucide-react";
import { isValidPhoneNumber } from "libphonenumber-js/min";
import PhoneInput from "react-phone-number-input";
import es from "react-phone-number-input/locale/es.json";
import en from "react-phone-number-input/locale/en.json";
import { BrandLogo, BrandMark } from "./brand-logo";
import { LanguageSwitcher } from "./language-switcher";
import { Link } from "@/i18n/navigation";
import "./auth-steps.css";

type AuthFormProps = { onAuthenticated: () => void; initialError?: string; initialMode?: "login" | "register" };
type VerifyStepState = { email: string; sent: boolean; fromLogin: boolean };

const resendCooldownSeconds = 60;
const emailPattern = /^\S+@\S+\.\S+$/;

type ResendStatus = "idle" | "sending" | "sent" | "error";

function useResendVerification(email: string, initialCooldown = 0) {
  const locale = useLocale();
  const [status, setStatus] = useState<ResendStatus>("idle");
  const [remaining, setRemaining] = useState(initialCooldown);

  useEffect(() => {
    if (remaining <= 0) return;
    const timer = setTimeout(() => setRemaining((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [remaining]);

  async function resend() {
    if (status === "sending" || remaining > 0) return;
    setStatus("sending");
    try {
      const response = await fetch("/api/auth/verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, locale }),
      });
      if (!response.ok) throw new Error("resend failed");
      setStatus("sent");
      setRemaining(resendCooldownSeconds);
    } catch {
      setStatus("error");
    }
  }

  return { status, remaining, resend };
}

function ResendAction({ resend, type = "button", disabled = false }: { resend: ReturnType<typeof useResendVerification>; type?: "button" | "submit"; disabled?: boolean }) {
  const t = useTranslations("Verification");
  const sending = resend.status === "sending";
  return (
    <>
      <button
        className="primary-button auth-submit"
        type={type}
        onClick={type === "button" ? resend.resend : undefined}
        disabled={sending || resend.remaining > 0 || disabled}
      >
        {sending && <LoaderCircle className="auth-spin" size={16} aria-hidden="true" />}
        {sending ? t("resending") : resend.remaining > 0 ? t("resendIn", { seconds: resend.remaining }) : t("resend")}
      </button>
      <p className="auth-feedback" role="status" data-tone={resend.status === "error" ? "error" : undefined}>
        {resend.status === "sent" ? t("resendSuccess") : resend.status === "error" ? t("resendFailed") : ""}
      </p>
    </>
  );
}

function AuthSteps({ current }: { current: 1 | 2 }) {
  const t = useTranslations("Verification");
  const steps = [t("stepAccount"), t("stepVerification")];
  return (
    <ol className="auth-steps" aria-label={t("stepsLabel")}>
      {steps.map((label, index) => {
        const number = index + 1;
        const done = number < current;
        return (
          <li key={label} className="auth-step" data-done={done} aria-current={number === current ? "step" : undefined}>
            <span className="auth-step-index" aria-hidden="true">{done ? <Check size={12} strokeWidth={3} /> : number}</span>
            <span>{label}{done && <span className="sr-only"> ({t("stepDone")})</span>}</span>
          </li>
        );
      })}
    </ol>
  );
}

function VerifyStep({ state, onChangeEmail, onLogin }: { state: VerifyStepState; onChangeEmail: () => void; onLogin: () => void }) {
  const t = useTranslations("Verification");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const resend = useResendVerification(state.email, state.sent ? resendCooldownSeconds : 0);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <>
      <AuthSteps current={2} />
      <span className="auth-verify-icon" aria-hidden="true"><Mail size={22} /></span>
      <h1 id="auth-title" ref={headingRef} tabIndex={-1}>{t("verifyTitle")}</h1>
      <p className="auth-intro">
        {t.rich(state.fromLogin ? "verifyIntroLogin" : state.sent ? "verifyIntro" : "verifyIntroNotSent", { email: state.email, strong: (chunks) => <strong className="auth-verify-email">{chunks}</strong> })}
      </p>
      {(state.sent || resend.status === "sent") && <p className="auth-verify-hint">{t("verifyHint")}</p>}
      <div className="auth-verify-actions">
        <ResendAction resend={resend} />
        <button className="auth-secondary-button" type="button" onClick={onChangeEmail}>{t("changeEmail")}</button>
      </div>
      <p className="auth-switch">
        {t("alreadyVerified")}{" "}
        <button type="button" onClick={onLogin}>{t("startSession")}</button>
      </p>
    </>
  );
}

type VerifyResult = "verified" | "invalid" | "failed";
type PanelState = "ready" | "loading" | VerifyResult;

export function VerifyEmailPanel({ token, locale, initialResult }: { token: string; locale: string; initialResult?: VerifyResult }) {
  const t = useTranslations("Verification");
  const [state, setState] = useState<PanelState>(initialResult ?? (token ? "ready" : "invalid"));
  const [email, setEmail] = useState("");
  const resend = useResendVerification(email.trim().toLowerCase());

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("loading");
    try {
      const response = await fetch("/api/auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, locale }),
      });
      const payload = (await response.json()) as { result?: VerifyResult };
      setState(payload.result === "verified" || payload.result === "invalid" ? payload.result : "failed");
    } catch {
      setState("failed");
    }
  }

  function requestNewLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void resend.resend();
  }

  if (state === "loading") {
    return (
      <div role="status" aria-live="polite">
        <span className="auth-verify-icon" aria-hidden="true"><LoaderCircle className="auth-spin" size={22} /></span>
        <h1 id="verify-email-title">{t("loading")}</h1>
      </div>
    );
  }

  if (state === "verified") {
    return (
      <div role="status" aria-live="polite">
        <span className="auth-verify-icon" aria-hidden="true"><CircleCheck size={22} /></span>
        <h1 id="verify-email-title">{t("verifiedTitle")}</h1>
        <p className="auth-intro">{t("verifiedDescription")}</p>
        <div className="auth-verify-actions">
          <Link className="primary-button auth-submit" href="/buscar">{t("continue")}</Link>
        </div>
      </div>
    );
  }

  if (state === "failed") {
    return (
      <>
        <span className="auth-verify-icon" data-tone="error" aria-hidden="true"><TriangleAlert size={22} /></span>
        <h1 id="verify-email-title">{t("failedTitle")}</h1>
        <p className="auth-intro" role="alert">{t("failed")}</p>
        <div className="auth-verify-actions">
          {token && <button className="primary-button auth-submit" type="button" onClick={() => setState("ready")}>{t("retry")}</button>}
          <Link className="auth-secondary-button" href="/buscar">{t("backToLeadta")}</Link>
        </div>
        <p className="field-help verification-footnote">{t("privacy")}</p>
      </>
    );
  }

  if (state === "invalid") {
    return (
      <>
        <span className="auth-verify-icon" data-tone="error" aria-hidden="true"><TriangleAlert size={22} /></span>
        <h1 id="verify-email-title">{t("invalidTitle")}</h1>
        <p className="auth-intro">{t("invalid")}</p>
        <form className="auth-fields" onSubmit={requestNewLink}>
          <label className="field">
            <span className="field-label">{t("email")}<span className="required-mark" aria-hidden="true"> *</span></span>
            <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} />
          </label>
          <div className="auth-verify-actions">
            <ResendAction resend={resend} type="submit" disabled={!emailPattern.test(email.trim())} />
          </div>
        </form>
        <p className="field-help verification-footnote">{t("privacy")}</p>
      </>
    );
  }

  return (
    <>
      <h1 id="verify-email-title">{t("title")}</h1>
      <p className="auth-intro">{t("description")}</p>
      <form className="auth-fields" action="/api/auth/verify-email" method="post" onSubmit={confirm}>
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="locale" value={locale} />
        <button className="primary-button auth-submit" type="submit">{t("button")}</button>
      </form>
      <p className="field-help verification-footnote">{t("privacy")}</p>
    </>
  );
}

export function AuthForm({ onAuthenticated, initialError = "", initialMode = "login" }: AuthFormProps) {
  const t = useTranslations("Auth");
  const locale = useLocale();
  const localizedError = (message: string) => {
    if (locale !== "en") return message;
    const messages: Record<string, string> = {
      "No se pudo conectar con el servicio de cuentas.": t("serviceUnavailable"),
      "No se pudo completar el acceso con Google. Intenta nuevamente.": t("googleLoginFailed"),
      "Email o contraseña incorrectos.": t("invalidCredentials"),
      "Ingresá un email y una contraseña válidos.": t("validEmailPassword"),
      "Ingresá un email válido.": t("validEmail"),
      "Ingresá los datos requeridos para crear la cuenta.": t("validRequired"),
      "No se pudo crear la cuenta. Revisá si el email ya está registrado.": t("accountExists"),
      "Ingresá un número de teléfono válido.": t("validPhone"),
      "La contraseña debe tener al menos 6 caracteres.": t("passwordLength"),
      "Las contraseñas no coinciden.": t("passwordMismatch"),
      "Ese teléfono ya está registrado.": t("phoneTaken"),
      "La contraseña debe tener entre 6 y 128 caracteres.": t("passwordRange"),
    };
    return messages[message] ?? message;
  };
  const [mode, setMode] = useState<"login" | "register">(initialMode);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false);
  const [error, setError] = useState(() => localizedError(initialError));
  const [verifyStep, setVerifyStep] = useState<VerifyStepState | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (mode === "register") {
      if (!phone || !isValidPhoneNumber(phone)) {
        setPhoneTouched(true);
        setError(t("validPhone"));
        document.getElementById("phone")?.focus();
        return;
      }
      if (password.length < 6) {
        setError(t("passwordLength"));
        document.getElementById("password")?.focus();
        return;
      }
      if (password !== passwordConfirm) {
        setError(t("passwordMismatch"));
        document.getElementById("password-confirm")?.focus();
        return;
      }
    }

    setBusy(true);
    try {
      const response = await fetch(`/api/auth/${mode === "register" ? "register" : "login"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "register" ? { email, phone, password, passwordConfirm, locale } : { email, password }),
      });
      const payload = await response.json();
      if (payload.code === "EMAIL_NOT_VERIFIED") {
        setVerifyStep({ email: email.trim().toLowerCase(), sent: false, fromLogin: true });
        return;
      }
      if (!response.ok) throw new Error(payload.error || t("loginFailed"));
      if (payload.verificationRequired) {
        setVerifyStep({ email: email.trim().toLowerCase(), sent: Boolean(payload.verificationSent), fromLogin: false });
        return;
      }
      if (payload.user?.role === "owner") {
        window.location.assign(window.location.pathname.startsWith("/en/") ? "/en/owner" : "/owner");
        return;
      }
      onAuthenticated();
    } catch (submitError) {
      setError(localizedError(submitError instanceof Error ? submitError.message : t("connectionFailed")));
    } finally {
      setBusy(false);
    }
  }

  function switchMode() {
    setError("");
    setMode(mode === "register" ? "login" : "register");
  }

  function backToForm(nextMode: "login" | "register") {
    setVerifyStep(null);
    setError("");
    setMode(nextMode);
    requestAnimationFrame(() => document.getElementById("auth-title")?.focus());
  }

  return (
    <main className="app-shell auth-shell">
      <header className="topbar">
        <BrandLogo />
        <div className="topbar-actions"><LanguageSwitcher /><Link className="topbar-note auth-pricing-link" href="/pricing">{t("pricing")}</Link></div>
      </header>
      <div className="auth-workspace">
        <section className="search-panel auth-panel" aria-labelledby="auth-title">
          <BrandMark className="auth-brand-mark" />
          {verifyStep ? (
            <VerifyStep state={verifyStep} onChangeEmail={() => backToForm(mode)} onLogin={() => backToForm("login")} />
          ) : (
          <>
          {mode === "register" && <AuthSteps current={1} />}
          <h1 id="auth-title" tabIndex={-1}>{mode === "register" ? t("registerTitle") : t("loginTitle")}</h1>
          <p className="auth-intro">{mode === "register" && t("registerIntro")}{t("privateIntro")}</p>
          <a className="google-auth-button" href={`/api/auth/google?locale=${locale}`}>{t("continueWithGoogle")}</a>
          <div className="auth-divider" aria-hidden="true"><span>{t("orContinueWithEmail")}</span></div>
          <form className="auth-fields" onSubmit={submit}>
            <label className="field">
              <span className="field-label">{t("email")}<span className="required-mark" aria-hidden="true"> *</span></span>
              <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} />
            </label>
            {mode === "register" && (
              <div className="field">
                <label className="field-label" htmlFor="phone">{t("phone")}<span className="required-mark" aria-hidden="true"> *</span></label>
                <PhoneInput
                  id="phone"
                  defaultCountry="AR"
                  labels={locale === "es" ? es : en}
                  value={phone}
                  onChange={(value) => setPhone(value || "")}
                  onBlur={() => setPhoneTouched(true)}
                  autoComplete="tel"
                  aria-invalid={phoneTouched && Boolean(phone) && !isValidPhoneNumber(phone)}
                  aria-describedby={phoneTouched && !isValidPhoneNumber(phone) ? "phone-error" : "phone-help"}
                  numberInputProps={{ id: "phone", required: true, "aria-label": t("phoneAria"), "aria-invalid": phoneTouched && Boolean(phone) && !isValidPhoneNumber(phone) }}
                  international
                />
                <span className="field-help" id="phone-help">{t("phoneHelp")}</span>
                {phoneTouched && !isValidPhoneNumber(phone) && <span className="field-help auth-inline-error" id="phone-error" role="status">{t("phoneInvalid")}</span>}
              </div>
            )}
            <label className="field">
              <span className="field-label">{t("password")}<span className="required-mark" aria-hidden="true"> *</span></span>
              <span className="password-control">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete={mode === "register" ? "new-password" : "current-password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  minLength={mode === "register" ? 6 : 1}
                  maxLength={128}
                  aria-describedby={mode === "register" ? "password-help" : undefined}
                />
                <button className="password-toggle" type="button" aria-label={showPassword ? t("hidePassword") : t("showPassword")} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>
                  {showPassword ? t("hidePassword") : t("showPassword")}
                </button>
              </span>
              {mode === "register" && (
                <span className="field-help password-requirements" id="password-help" aria-live="polite">
                  <span className={password.length >= 6 ? "requirement met" : "requirement"}>{password.length >= 6 ? "✓" : "•"} {t("minimumPassword")}</span>
                  <span className={passwordConfirm && password === passwordConfirm ? "requirement met" : "requirement"}>{passwordConfirm && password === passwordConfirm ? "✓" : "•"} {t("confirmMatch")}</span>
                </span>
              )}
            </label>
            {mode === "register" && (
              <label className="field">
                <span className="field-label">{t("confirmPassword")}<span className="required-mark" aria-hidden="true"> *</span></span>
                <span className="password-control">
                  <input
                    id="password-confirm"
                    type={showPasswordConfirm ? "text" : "password"}
                    autoComplete="new-password"
                    value={passwordConfirm}
                    onChange={(event) => setPasswordConfirm(event.target.value)}
                    required
                    maxLength={128}
                    aria-invalid={Boolean(passwordConfirm && password !== passwordConfirm)}
                    aria-describedby={passwordConfirm && password !== passwordConfirm ? "password-confirm-error" : undefined}
                  />
                  <button className="password-toggle" type="button" aria-label={showPasswordConfirm ? t("hideConfirm") : t("showConfirm")} aria-pressed={showPasswordConfirm} onClick={() => setShowPasswordConfirm(!showPasswordConfirm)}>
                    {showPasswordConfirm ? t("hidePassword") : t("showPassword")}
                  </button>
                </span>
                {passwordConfirm && password !== passwordConfirm && <span className="field-help auth-inline-error" id="password-confirm-error" role="status">{t("passwordMismatch")}</span>}
              </label>
            )}
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button className="primary-button auth-submit" type="submit" disabled={busy}>
              {busy ? t("connecting") : mode === "register" ? t("createAccount") : t("signIn")}
            </button>
          </form>
          <p className="auth-switch">
            {mode === "register" ? t("alreadyAccount") : t("firstTime")}{" "}
            <button type="button" onClick={switchMode}>
              {mode === "register" ? t("startSession") : t("createAccount")}
            </button>
          </p>
          </>
          )}
        </section>
      </div>
    </main>
  );
}
