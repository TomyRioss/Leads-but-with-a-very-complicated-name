"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { isValidPhoneNumber } from "libphonenumber-js/min";
import PhoneInput from "react-phone-number-input";
import es from "react-phone-number-input/locale/es.json";
import en from "react-phone-number-input/locale/en.json";
import { BrandLogo, BrandMark } from "./brand-logo";
import { LanguageSwitcher } from "./language-switcher";

type AuthFormProps = { onAuthenticated: () => void; initialError?: string; initialMode?: "login" | "register" };

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
        body: JSON.stringify(mode === "register" ? { email, phone, password, passwordConfirm } : { email, password }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || t("loginFailed"));
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

  return (
    <main className="app-shell auth-shell">
      <header className="topbar">
        <BrandLogo />
        <div className="topbar-actions"><LanguageSwitcher /><Link className="topbar-note auth-pricing-link" href="/pricing">{t("pricing")}</Link></div>
      </header>
      <div className="auth-workspace">
        <section className="search-panel auth-panel" aria-labelledby="auth-title">
          <BrandMark className="auth-brand-mark" />
          <h1 id="auth-title">{mode === "register" ? t("registerTitle") : t("loginTitle")}</h1>
          <p className="auth-intro">{mode === "register" && t("registerIntro")}{t("privateIntro")}</p>
          <a className="google-auth-button" href={`/api/auth/google?locale=${locale}`}>{t("continueWithGoogle")}</a>
          <div className="auth-divider" aria-hidden="true"><span>{t("orContinueWithEmail")}</span></div>
          <form className="auth-fields" onSubmit={submit}>
            <label className="field">
              <span className="field-label">Email<span className="required-mark" aria-hidden="true"> *</span></span>
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
        </section>
      </div>
    </main>
  );
}
