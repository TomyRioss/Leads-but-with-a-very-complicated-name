"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { isValidPhoneNumber } from "libphonenumber-js/min";
import PhoneInput from "react-phone-number-input";
import es from "react-phone-number-input/locale/es.json";
import { BrandLogo, BrandMark } from "./brand-logo";

type AuthFormProps = { onAuthenticated: () => void; initialError?: string; initialMode?: "login" | "register" };

export function AuthForm({ onAuthenticated, initialError = "", initialMode = "login" }: AuthFormProps) {
  const [mode, setMode] = useState<"login" | "register">(initialMode);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false);
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (mode === "register") {
      if (!phone || !isValidPhoneNumber(phone)) {
        setPhoneTouched(true);
        setError("Ingresá un número de teléfono válido.");
        document.getElementById("phone")?.focus();
        return;
      }
      if (password.length < 6) {
        setError("La contraseña debe tener al menos 6 caracteres.");
        document.getElementById("password")?.focus();
        return;
      }
      if (password !== passwordConfirm) {
        setError("Las contraseñas no coinciden.");
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
      if (!response.ok) throw new Error(payload.error || "No se pudo iniciar sesión.");
      if (payload.user?.role === "owner") {
        window.location.assign("/owner");
        return;
      }
      onAuthenticated();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "No se pudo conectar con tu cuenta.");
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
        <Link className="topbar-note auth-pricing-link" href="/pricing">Planes y precios</Link>
      </header>
      <div className="auth-workspace">
        <section className="search-panel auth-panel" aria-labelledby="auth-title">
          <BrandMark className="auth-brand-mark" />
          <h1 id="auth-title">{mode === "register" ? "Creá tu cuenta" : "Ingresá a Leadta"}</h1>
          <p className="auth-intro">{mode === "register" && "Creá tu cuenta y recibí 25 créditos gratis. "}Tus búsquedas y leads quedan guardados en tu historial privado.</p>
          <form className="auth-fields" onSubmit={submit}>
            <label className="field">
              <span className="field-label">Email<span className="required-mark" aria-hidden="true"> *</span></span>
              <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} />
            </label>
            {mode === "register" && (
              <div className="field">
                <label className="field-label" htmlFor="phone">Teléfono<span className="required-mark" aria-hidden="true"> *</span></label>
                <PhoneInput
                  id="phone"
                  defaultCountry="AR"
                  labels={es}
                  value={phone}
                  onChange={(value) => setPhone(value || "")}
                  onBlur={() => setPhoneTouched(true)}
                  autoComplete="tel"
                  aria-invalid={phoneTouched && Boolean(phone) && !isValidPhoneNumber(phone)}
                  aria-describedby={phoneTouched && !isValidPhoneNumber(phone) ? "phone-error" : "phone-help"}
                  numberInputProps={{ id: "phone", required: true, "aria-label": "Número de teléfono", "aria-invalid": phoneTouched && Boolean(phone) && !isValidPhoneNumber(phone) }}
                  international
                />
                <span className="field-help" id="phone-help">Elegí el país y escribí el resto del número.</span>
                {phoneTouched && !isValidPhoneNumber(phone) && <span className="field-help auth-inline-error" id="phone-error" role="status">Ingresá un número completo y válido.</span>}
              </div>
            )}
            <label className="field">
              <span className="field-label">Contraseña<span className="required-mark" aria-hidden="true"> *</span></span>
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
                <button className="password-toggle" type="button" aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>
                  {showPassword ? "Ocultar" : "Mostrar"}
                </button>
              </span>
              {mode === "register" && (
                <span className="field-help password-requirements" id="password-help" aria-live="polite">
                  <span className={password.length >= 6 ? "requirement met" : "requirement"}>{password.length >= 6 ? "✓" : "•"} Al menos 6 caracteres</span>
                  <span className={passwordConfirm && password === passwordConfirm ? "requirement met" : "requirement"}>{passwordConfirm && password === passwordConfirm ? "✓" : "•"} La confirmación debe coincidir</span>
                </span>
              )}
            </label>
            {mode === "register" && (
              <label className="field">
                <span className="field-label">Confirmar contraseña<span className="required-mark" aria-hidden="true"> *</span></span>
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
                  <button className="password-toggle" type="button" aria-label={showPasswordConfirm ? "Ocultar confirmación" : "Mostrar confirmación"} aria-pressed={showPasswordConfirm} onClick={() => setShowPasswordConfirm(!showPasswordConfirm)}>
                    {showPasswordConfirm ? "Ocultar" : "Mostrar"}
                  </button>
                </span>
                {passwordConfirm && password !== passwordConfirm && <span className="field-help auth-inline-error" id="password-confirm-error" role="status">Las contraseñas no coinciden.</span>}
              </label>
            )}
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button className="primary-button auth-submit" type="submit" disabled={busy}>
              {busy ? "Conectando…" : mode === "register" ? "Crear cuenta" : "Iniciar sesión"}
            </button>
          </form>
          <p className="auth-switch">
            {mode === "register" ? "¿Ya tenés cuenta?" : "¿Primera vez en Leadta?"}{" "}
            <button type="button" onClick={switchMode}>
              {mode === "register" ? "Iniciá sesión" : "Crear cuenta"}
            </button>
          </p>
        </section>
      </div>
    </main>
  );
}
