"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CircleAlert, Coins, Eye, KeyRound, LoaderCircle, PencilLine, RefreshCw, Send, Sparkles } from "lucide-react";
import { getPathname, Link } from "@/i18n/navigation";
import "./oauth-consent.css";

type Scope = "read" | "write" | "credits" | "send";
type OptionalScope = Extract<Scope, "credits" | "send">;
type ConsentRequest = { clientName: string; clientUri?: string; redirectHost: string; scopes: Scope[] };
type View =
  | { kind: "loading" }
  | { kind: "login" }
  | { kind: "plan" }
  | { kind: "invalid" }
  | { kind: "error" }
  | { kind: "ready"; request: ConsentRequest };

const ENDPOINT = "/api/oauth/authorize";
const REQUEST_TIMEOUT_MS = 15_000;
const KNOWN_SCOPES: readonly Scope[] = ["read", "write", "credits", "send"];
const OPTIONAL_SCOPES: readonly OptionalScope[] = ["credits", "send"];
const scopeIcons = { read: Eye, write: PencilLine, credits: Coins, send: Send } as const;

/** Never navigate to script/data URLs, even if the API were to return one. */
function isSafeRedirect(value: unknown): value is string {
  if (typeof value !== "string" || !value) return false;
  try {
    const { protocol } = new URL(value, window.location.href);
    return protocol !== "javascript:" && protocol !== "data:" && protocol !== "vbscript:";
  } catch {
    return false;
  }
}

async function fetchWithTimeout(input: string, init?: RequestInit) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, cache: "no-store", signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

/** Consent screen for MCP clients (claude.ai, ChatGPT…): every OAuth query param goes to the API untouched. */
export function OAuthConsent() {
  const t = useTranslations("oauth");
  const locale = useLocale();
  const [view, setView] = useState<View>({ kind: "loading" });
  const [enabled, setEnabled] = useState<Record<OptionalScope, boolean>>({ credits: true, send: true });
  const [submitting, setSubmitting] = useState<"" | "allow" | "deny">("");
  const [submitError, setSubmitError] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);

  const goToLogin = useCallback(() => {
    setView({ kind: "login" });
    const next = `${window.location.pathname}${window.location.search}`;
    window.location.replace(`${getPathname({ href: "/login", locale })}?next=${encodeURIComponent(next)}`);
  }, [locale]);

  const load = useCallback(async () => {
    setView({ kind: "loading" });
    try {
      const response = await fetchWithTimeout(`${ENDPOINT}${window.location.search}`);
      if (response.status === 401) return goToLogin();
      if (response.status === 402) return setView({ kind: "plan" });
      if (response.status === 400) return setView({ kind: "invalid" });
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json() as Partial<ConsentRequest>;
      if (typeof data.clientName !== "string" || typeof data.redirectHost !== "string") throw new Error("payload");
      const scopes = (Array.isArray(data.scopes) ? data.scopes : []).filter((scope): scope is Scope => KNOWN_SCOPES.includes(scope));
      setView({ kind: "ready", request: { clientName: data.clientName, clientUri: data.clientUri, redirectHost: data.redirectHost, scopes } });
    } catch {
      setView({ kind: "error" });
    }
  }, [goToLogin]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial de la solicitud
  useEffect(() => { void load(); }, [load]);
  // Move focus to the new heading when the state changes (screen readers announce the result).
  useEffect(() => { if (view.kind !== "loading") headingRef.current?.focus(); }, [view.kind]);

  async function submit(decision: "allow" | "deny", request: ConsentRequest) {
    setSubmitting(decision);
    setSubmitError("");
    const optional = OPTIONAL_SCOPES.filter((scope) => request.scopes.includes(scope) && enabled[scope]);
    const body = {
      ...Object.fromEntries(new URLSearchParams(window.location.search)),
      decision,
      scopes: decision === "allow" ? ["read", "write", ...optional] : [],
    };
    try {
      const response = await fetchWithTimeout(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (response.status === 401) return goToLogin();
      if (response.status === 402) { setSubmitting(""); return setView({ kind: "plan" }); }
      if (response.status === 400) { setSubmitting(""); return setView({ kind: "invalid" }); }
      if (!response.ok) throw new Error(String(response.status));
      const { redirectTo } = await response.json() as { redirectTo?: unknown };
      if (!isSafeRedirect(redirectTo)) throw new Error("redirect");
      // Buttons stay disabled while the browser leaves the page.
      window.location.assign(redirectTo);
    } catch {
      setSubmitting("");
      setSubmitError(t("submitError"));
    }
  }

  if (view.kind === "loading" || view.kind === "login") {
    return (
      <div className="oauth-state" role="status" aria-live="polite">
        <LoaderCircle className="auth-spin" size={20} aria-hidden="true" />
        <h1 id="oauth-title">{t(view.kind === "login" ? "redirectingLogin" : "loading")}</h1>
      </div>
    );
  }

  if (view.kind === "plan") {
    return (
      <>
        <div className="auth-verify-icon" aria-hidden="true"><Sparkles size={22} /></div>
        <h1 id="oauth-title" ref={headingRef} tabIndex={-1}>{t("planTitle")}</h1>
        <p className="auth-intro">{t("planBody")}</p>
        <div className="auth-verify-actions">
          <Link className="primary-button auth-submit oauth-button" href="/pricing">{t("planCta")}</Link>
        </div>
      </>
    );
  }

  if (view.kind === "invalid" || view.kind === "error") {
    const invalid = view.kind === "invalid";
    return (
      <>
        <div className="auth-verify-icon" data-tone="error" aria-hidden="true"><CircleAlert size={22} /></div>
        <h1 id="oauth-title" ref={headingRef} tabIndex={-1}>{t("invalidTitle")}</h1>
        <p className="auth-intro" role="alert">{invalid ? t("invalidBody") : t("loadError")}</p>
        {!invalid && (
          <div className="auth-verify-actions">
            <button type="button" className="auth-secondary-button oauth-button" onClick={() => void load()}>
              <RefreshCw size={16} aria-hidden="true" /> {t("retry")}
            </button>
          </div>
        )}
      </>
    );
  }

  const { request } = view;
  const optional = OPTIONAL_SCOPES.filter((scope) => request.scopes.includes(scope));
  const busy = submitting !== "";
  return (
    <>
      <div className="auth-verify-icon" aria-hidden="true"><KeyRound size={22} /></div>
      <h1 id="oauth-title" ref={headingRef} tabIndex={-1}>{t("title", { client: request.clientName })}</h1>
      <p className="auth-intro">{t.rich("redirectHost", { host: request.redirectHost, strong: (chunks) => <strong className="oauth-host">{chunks}</strong> })}</p>

      <h2 className="oauth-perms-title">{t("permissionsTitle")}</h2>
      <ul className="oauth-scopes">
        {(["read", "write"] as const).map((scope) => {
          const Icon = scopeIcons[scope];
          return (
            <li key={scope} className="oauth-scope">
              <span className="oauth-scope-icon" aria-hidden="true"><Icon size={16} /></span>
              <span className="oauth-scope-text">
                <strong>{t(`scopes.${scope}.title`)}</strong>
                <span>{t(`scopes.${scope}.description`)}</span>
              </span>
              <span className="oauth-scope-badge">{t("included")}</span>
            </li>
          );
        })}
        {optional.map((scope) => {
          const Icon = scopeIcons[scope];
          return (
            <li key={scope}>
              <label className="oauth-scope oauth-scope-toggle full-data-toggle">
                <span className="oauth-scope-icon" aria-hidden="true"><Icon size={16} /></span>
                <span className="oauth-scope-text">
                  <strong>{t(`scopes.${scope}.title`)}</strong>
                  <span>{t(`scopes.${scope}.description`)}</span>
                </span>
                <input type="checkbox" role="switch" checked={enabled[scope]} disabled={busy} onChange={(event) => setEnabled((current) => ({ ...current, [scope]: event.target.checked }))} />
                <span className="full-data-track" aria-hidden="true" />
              </label>
            </li>
          );
        })}
      </ul>

      <p className="auth-verify-hint">{t("trustHint")}</p>
      <div className="oauth-actions">
        <button type="button" className="primary-button auth-submit oauth-button" disabled={busy} onClick={() => void submit("allow", request)}>
          {submitting === "allow" && <LoaderCircle className="auth-spin" size={16} aria-hidden="true" />}
          {submitting === "allow" ? t("allowing") : t("allow")}
        </button>
        <button type="button" className="auth-secondary-button oauth-button" disabled={busy} onClick={() => void submit("deny", request)}>
          {submitting === "deny" ? t("canceling") : t("cancel")}
        </button>
      </div>
      <p className="auth-feedback oauth-feedback" data-tone="error" role="alert" aria-live="assertive">{submitError}</p>
    </>
  );
}
