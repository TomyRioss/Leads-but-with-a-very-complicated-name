"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Blocks, Check, Copy, LoaderCircle, RefreshCw, Unplug } from "lucide-react";
import { GoogleDriveConnect, GoogleFeatureCard } from "@/app/google-drive-connect";
import { WhatsAppConnectCard } from "@/app/whatsapp-connect";
import { useIntegrationFlash } from "@/lib/client/integration-flash";
import { getSession } from "@/lib/client/session";
import "@/app/google-drive-connect.css";
import "./integrations-view.css";

const notices = { connected: "noticeConnected", denied: "noticeDenied", error: "noticeError", not_configured: "notConfigured" } as const;

/**
 * Aviso del resultado del OAuth (flash cookie, una sola vez) + tarjetas de Google Drive, Gmail, Calendar y WhatsApp.
 * `returnTo`: adónde vuelve el OAuth de Google (la página o Leadtita, cuando se abre como modal desde el chat).
 * "Apps conectadas" (MCP) solo en la página: el modal de Leadtita es para conectar canales.
 */
export function IntegrationsView({ returnTo = "/integraciones" }: { returnTo?: "/integraciones" | "/leadtita" }) {
  const t = useTranslations("integrations");
  const result = useIntegrationFlash("google")?.status ?? null;
  const key = result ? notices[result] : null;
  return (
    <>
      {key && <p className="integrations-notice" role="status" data-tone={result === "connected" ? "ok" : "error"}>{t(key)}</p>}
      <div className="integrations-grid">
        <GoogleDriveConnect returnTo={returnTo} />
        <GoogleFeatureCard feature="gmail" returnTo={returnTo} />
        <GoogleFeatureCard feature="calendar" returnTo={returnTo} />
        <WhatsAppConnectCard />
        {returnTo === "/integraciones" && <ConnectedAppsCard />}
      </div>
    </>
  );
}

type Grant = { id: string; clientName: string; scopes: string[]; createdAt: string; lastUsedAt: string | null };
type AppsStatus = "loading" | "hidden" | "ready" | "error";

const GRANTS_URL = "/api/oauth/grants";
const SCOPE_ORDER = ["read", "write", "credits", "send"] as const;

/** Apps conectadas por OAuth (claude.ai, ChatGPT…): lista, desconectar con confirmación inline y cómo conectar. Solo con sesión. */
function ConnectedAppsCard() {
  const t = useTranslations("integrations.apps");
  const format = useFormatter();
  const titleId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [status, setStatus] = useState<AppsStatus>("loading");
  const [grants, setGrants] = useState<Grant[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmId, setConfirmId] = useState("");
  const [busyId, setBusyId] = useState("");

  const load = useCallback(async () => {
    setStatus("loading");
    setError("");
    try {
      // Session and grants in parallel: signed-out users never see the card.
      const [session, response] = await Promise.all([getSession(), fetch(GRANTS_URL, { cache: "no-store" })]);
      if (!session.user || response.status === 401) return setStatus("hidden");
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json() as { items?: Grant[] };
      setGrants(Array.isArray(data.items) ? data.items : []);
      setStatus("ready");
    } catch {
      setError(t("loadError"));
      setStatus("error");
    }
  }, [t]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial de las apps
  useEffect(() => { void load(); }, [load]);
  // Keyboard users land on the confirm action when the inline confirmation opens.
  useEffect(() => { if (confirmId) confirmRef.current?.focus(); }, [confirmId]);

  async function disconnect(grant: Grant) {
    setBusyId(grant.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(GRANTS_URL, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: grant.id }) });
      if (!response.ok) throw new Error(String(response.status));
      setGrants((current) => current.filter((item) => item.id !== grant.id));
      setConfirmId("");
      setNotice(t("disconnected", { client: grant.clientName }));
      headingRef.current?.focus();
    } catch {
      setError(t("disconnectError"));
    } finally {
      setBusyId("");
    }
  }

  if (status === "hidden") return null;

  const formatDate = (value: string | null) => {
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? format.dateTime(date, { dateStyle: "medium" }) : null;
  };

  return (
    <section className="gdrive-card apps-card" aria-labelledby={titleId} aria-busy={status === "loading"}>
      <header className="gdrive-head">
        <span className="gdrive-logo" aria-hidden="true"><Blocks size={20} /></span>
        <div className="gdrive-head-text">
          <h2 id={titleId} ref={headingRef} tabIndex={-1}>{t("title")}</h2>
          <p>{t("description")}</p>
        </div>
      </header>

      {status === "loading" && <p className="gdrive-state" role="status"><LoaderCircle className="gdrive-spin" size={16} aria-hidden="true" /> {t("loading")}</p>}
      {error && (
        <p className="gdrive-error" role="alert">
          {error}
          {status === "error" && <button type="button" className="gdrive-link" onClick={() => void load()}><RefreshCw size={14} aria-hidden="true" /> {t("retry")}</button>}
        </p>
      )}
      <p className="apps-notice" role="status">{notice}</p>

      {status === "ready" && grants.length > 0 && (
        <ul className="apps-list">
          {grants.map((grant) => {
            const scopes = SCOPE_ORDER.filter((scope) => grant.scopes?.includes(scope));
            const connected = formatDate(grant.createdAt);
            const lastUsed = formatDate(grant.lastUsedAt);
            const busy = busyId === grant.id;
            return (
              <li key={grant.id} className="apps-item">
                <div className="apps-item-head">
                  <strong className="apps-item-name">{grant.clientName}</strong>
                  {scopes.length > 0 && (
                    <ul className="apps-scopes" aria-label={t("scopesLabel")}>
                      {scopes.map((scope) => <li key={scope}>{t(`scopes.${scope}`)}</li>)}
                    </ul>
                  )}
                </div>
                <p className="apps-item-meta">
                  {connected && <span>{t("connectedAt", { date: connected })}</span>}
                  <span>{lastUsed ? t("lastUsed", { date: lastUsed }) : t("neverUsed")}</span>
                </p>
                {confirmId === grant.id ? (
                  <div className="gdrive-confirm" role="group" aria-label={t("disconnectTitle", { client: grant.clientName })}>
                    <p>{t("disconnectBody", { client: grant.clientName })}</p>
                    <div>
                      <button ref={confirmRef} type="button" className="gdrive-danger" disabled={busy} onClick={() => void disconnect(grant)}>{busy ? t("disconnecting") : t("disconnectConfirm")}</button>
                      <button type="button" className="gdrive-secondary" disabled={busy} onClick={() => setConfirmId("")}>{t("cancel")}</button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="gdrive-link gdrive-disconnect" aria-label={t("disconnectTitle", { client: grant.clientName })} disabled={Boolean(busyId)} onClick={() => setConfirmId(grant.id)}>
                    <Unplug size={14} aria-hidden="true" /> {t("disconnect")}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {status === "ready" && (grants.length === 0 ? (
        <>
          <p className="gdrive-state">{t("empty")}</p>
          <ConnectHowTo />
        </>
      ) : (
        <details className="apps-howto">
          <summary>{t("howTo")}</summary>
          <ConnectHowTo />
        </details>
      ))}
    </section>
  );
}

/** URL del conector MCP (origen calculado en el cliente) + pasos cortos para claude.ai y ChatGPT. */
function ConnectHowTo() {
  const t = useTranslations("integrations.apps");
  const [copy, setCopy] = useState<"" | "copied" | "error">("");
  // Only rendered after the client-side load, so `window` is available.
  const url = `${window.location.origin}/api/mcp`;

  useEffect(() => {
    if (copy !== "copied") return;
    const timer = window.setTimeout(() => setCopy(""), 2000);
    return () => window.clearTimeout(timer);
  }, [copy]);

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(url);
      setCopy("copied");
    } catch {
      setCopy("error");
    }
  }

  return (
    <div className="apps-connect">
      <div className="apps-url">
        <span className="apps-url-label">{t("urlLabel")}</span>
        <div className="apps-url-row">
          <code>{url}</code>
          <button type="button" className="gdrive-secondary" onClick={() => void copyUrl()}>
            {copy === "copied" ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
            {copy === "copied" ? t("copied") : t("copy")}
          </button>
        </div>
        <p className="gdrive-hint" role="status">{copy === "error" ? t("copyError") : ""}</p>
      </div>
      <ol className="apps-steps">
        <li>{t("claude")}</li>
        <li>{t("chatgpt")}</li>
      </ol>
    </div>
  );
}
