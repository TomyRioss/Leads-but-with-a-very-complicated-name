"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { BrandLogo, BrandMark } from "./brand-logo";

type AuthFormProps = { onAuthenticated: () => void; initialError?: string };

export function AuthForm({ onAuthenticated, initialError = "" }: AuthFormProps) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const response = await fetch(`/api/auth/${mode === "register" ? "register" : "login"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No se pudo iniciar sesión.");
      onAuthenticated();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "No se pudo conectar con tu cuenta.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app-shell auth-shell">
      <header className="topbar">
        <BrandLogo />
        <span className="topbar-note">Workspace de prospección</span>
      </header>
      <div className="auth-workspace">
        <section className="search-panel auth-panel" aria-labelledby="auth-title">
          <BrandMark className="auth-brand-mark" />
          <h1 id="auth-title">{mode === "register" ? "Creá tu cuenta" : "Ingresá a Leadta"}</h1>
          <p className="auth-intro">Tus búsquedas y leads quedan guardados en tu historial privado.</p>
          <form className="auth-fields" onSubmit={submit}>
            <label className="field">
              <span className="field-label">Email</span>
              <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} />
            </label>
            <label className="field">
              <span className="field-label">Contraseña</span>
              <input
                type="password"
                autoComplete={mode === "register" ? "new-password" : "current-password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={mode === "register" ? 10 : 1}
                maxLength={128}
                aria-describedby={mode === "register" ? "password-help" : undefined}
              />
              {mode === "register" && <span className="field-help" id="password-help">Usá al menos 10 caracteres.</span>}
            </label>
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button className="primary-button auth-submit" type="submit" disabled={busy}>
              {busy ? "Conectando…" : mode === "register" ? "Crear cuenta" : "Iniciar sesión"}
            </button>
          </form>
          <p className="auth-switch">
            {mode === "register" ? "¿Ya tenés cuenta?" : "¿Primera vez en Leadta?"}{" "}
            <button type="button" onClick={() => { setError(""); setMode(mode === "register" ? "login" : "register"); }}>
              {mode === "register" ? "Iniciá sesión" : "Crear cuenta"}
            </button>
          </p>
        </section>
      </div>
    </main>
  );
}
