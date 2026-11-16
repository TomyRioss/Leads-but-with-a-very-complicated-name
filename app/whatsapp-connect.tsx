"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { LoaderCircle, QrCode, RefreshCw, ShieldAlert, Unplug } from "lucide-react";
import { SiWhatsapp } from "react-icons/si";
import "./google-drive-connect.css";
import "./whatsapp-connect.css";

type WaState = "disconnected" | "connecting" | "qr" | "connected";
type Status = { configured: boolean; status: WaState; qrDataUrl: string | null; phone: string | null; sentThisMonth: number; monthlyLimit: number; queued: number };
type ErrorKind = "" | "load" | "worker" | "connect" | "disconnect";

const BASE = "/api/integrations/whatsapp";
const POLL_MS = 2500;
const POLL_MAX_MS = 3 * 60_000;
const REQUEST_TIMEOUT_MS = 15_000;
/** Other cards (page + chat) reload when one of them connects or disconnects. */
const STATUS_EVENT = "leadta:whatsapp-status";

class HttpError extends Error {
  constructor(readonly status: number) { super(String(status)); }
}

/** Only the last 4 digits stay visible. */
const maskPhone = (phone: string) => {
  const digits = phone.replace(/\D/g, "");
  return digits.length > 4 ? `•••• ${digits.slice(-4)}` : digits;
};

/** WhatsApp (Baileys) link card: QR scan, daily usage and queue. Used on /integraciones and inline in Leadtita (`compact`). */
export function WhatsAppConnectCard({ compact = false }: { compact?: boolean }) {
  const t = useTranslations("integrations.whatsapp");
  const titleId = useId();
  const cardRef = useRef<HTMLElement>(null);
  const restoreFocusAfterConnect = useRef(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<ErrorKind>("");
  const [busy, setBusy] = useState<"" | "connect" | "disconnect">("");
  const [expired, setExpired] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [remainingMs, setRemainingMs] = useState(POLL_MAX_MS);
  const inFlight = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const pollStart = useRef(0);

  /** Single in-flight request: a new one aborts the previous. Resolves null when aborted by unmount. */
  const call = useCallback(async <T,>(path: string, method: "GET" | "POST"): Promise<T | null> => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${BASE}/${path}`, { method, cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new HttpError(response.status);
      return (await response.json()) as T;
    } catch (cause) {
      if (!mounted.current) return null;
      throw cause;
    } finally {
      window.clearTimeout(timer);
      if (inFlight.current === controller) inFlight.current = null;
    }
  }, []);

  const failKind = (cause: unknown, fallback: ErrorKind): ErrorKind => (cause instanceof HttpError && cause.status === 503 ? "worker" : fallback);

  const load = useCallback(async () => {
    try {
      const next = await call<Status>("status", "GET");
      if (!next) return;
      setStatus(next);
      setError("");
    } catch (cause) {
      if (mounted.current) setError(failKind(cause, "load"));
    }
  }, [call]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; inFlight.current?.abort(); };
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial del estado
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const onChange = () => void load();
    window.addEventListener(STATUS_EVENT, onChange);
    return () => window.removeEventListener(STATUS_EVENT, onChange);
  }, [load]);
  useEffect(() => {
    if (status?.configured && status.status === "connected") {
      window.dispatchEvent(new Event(STATUS_EVENT));
    }
  }, [status?.configured, status?.status]);

  // Poll only while waiting for the scan, with the tab visible, for up to 3 minutes.
  const polling = Boolean(status?.configured) && (status?.status === "connecting" || status?.status === "qr") && !expired;
  useEffect(() => {
    if (!polling) { pollStart.current = 0; return; }
    if (!pollStart.current) pollStart.current = Date.now();
    let active = true;
    let timer: number | undefined;
    const schedule = () => { if (active && timer === undefined) timer = window.setTimeout(tick, POLL_MS); };
    async function tick() {
      timer = undefined;
      if (!active || document.visibilityState !== "visible") return;
      if (Date.now() - pollStart.current > POLL_MAX_MS) { setExpired(true); return; }
      if (!inFlight.current) await load();
      schedule();
    }
    const onVisibility = () => { if (document.visibilityState === "visible") schedule(); };
    schedule();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [polling, load]);
  // Visible countdown until polling gives up and the code is shown as expired.
  useEffect(() => {
    if (!polling) return;
    const tick = () => setRemainingMs(Math.max(0, POLL_MAX_MS - (Date.now() - (pollStart.current || Date.now()))));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [polling]);

  async function connect() {
    restoreFocusAfterConnect.current = true;
    setBusy("connect");
    setError("");
    setExpired(false);
    pollStart.current = Date.now();
    try {
      const next = await call<Status>("connect", "POST");
      if (next) setStatus(next);
    } catch (cause) {
      if (mounted.current) setError(failKind(cause, "connect"));
    } finally {
      if (mounted.current) setBusy("");
    }
  }

  async function disconnect() {
    setBusy("disconnect");
    setError("");
    try {
      const result = await call<{ status: WaState }>("disconnect", "POST");
      if (!result) return;
      setConfirmDisconnect(false);
      setStatus((current) => (current ? { ...current, status: "disconnected", qrDataUrl: null, phone: null } : current));
      window.dispatchEvent(new Event(STATUS_EVENT));
    } catch (cause) {
      if (mounted.current) setError(failKind(cause, "disconnect"));
    } finally {
      if (mounted.current) setBusy("");
    }
  }

  const state = status?.configured ? status.status : null;
  const waiting = state === "connecting" || state === "qr";
  useLayoutEffect(() => {
    if (!restoreFocusAfterConnect.current || !state || state === "disconnected") return;
    restoreFocusAfterConnect.current = false;
    cardRef.current?.focus({ preventScroll: true });
  }, [state]);
  const announcement = !status ? t("loading")
    : !status.configured ? t("notConfigured")
    : expired && waiting ? t("expired")
    : t(`states.${status.status}`);

  return (
    <section ref={cardRef} tabIndex={-1} className={`gdrive-card wa-card${compact ? " gdrive-card-compact" : ""}`} aria-labelledby={titleId} aria-busy={!status}>
      <header className="gdrive-head">
        <span className={`gdrive-logo wa-brand-logo${state === "connected" ? " is-connected" : ""}`} aria-hidden="true"><SiWhatsapp size={22} /></span>
        <div className="gdrive-head-text">
          <h2 id={titleId}>WhatsApp</h2>
          <p>{state === "connected" && status?.phone ? t("connectedAs", { phone: maskPhone(status.phone) }) : t("description")}</p>
        </div>
        {state === "connected" && <span className="gdrive-badge">{t("connected")}</span>}
      </header>

      <p className="sr-only" role="status">{announcement}</p>

      {!status && !error && <p className="gdrive-state"><LoaderCircle className="gdrive-spin" size={16} aria-hidden="true" /> {t("loading")}</p>}
      {error && (
        <p className="gdrive-error" role="alert">
          {t(`errors.${error}`)}
          {(!status || error === "load" || error === "worker") && busy === "" && (
            <button type="button" className="gdrive-link" onClick={() => void load()}><RefreshCw size={14} aria-hidden="true" /> {t("retry")}</button>
          )}
        </p>
      )}

      {status && !status.configured && <p className="gdrive-state">{t("notConfigured")}</p>}

      {state === "disconnected" && (
        <div className="gdrive-actions">
          <button type="button" className="gdrive-primary" disabled={busy !== ""} onClick={() => void connect()}>
            {busy === "connect" ? <LoaderCircle className="gdrive-spin" size={16} aria-hidden="true" /> : <QrCode size={16} aria-hidden="true" />} {t("connect")}
          </button>
        </div>
      )}

      {waiting && (expired ? (
        <div className="gdrive-actions">
          <p className="gdrive-state">{t("expired")}</p>
          <button type="button" className="gdrive-primary" disabled={busy !== ""} onClick={() => void connect()}>
            {busy === "connect" ? <LoaderCircle className="gdrive-spin" size={16} aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />} {t("newCode")}
          </button>
        </div>
      ) : (
        <div className="wa-pair">
          <div className="wa-qr">
            {state === "qr" && status?.qrDataUrl
              // eslint-disable-next-line @next/next/no-img-element -- data URL generated per session; next/image adds nothing here
              ? <img src={status.qrDataUrl} alt={t("qrAlt")} width={208} height={208} />
              : <span className="gdrive-state"><LoaderCircle className="gdrive-spin" size={16} aria-hidden="true" /> {t("generating")}</span>}
          </div>
          <ol className="wa-steps">
            <li>{t("steps.open")}</li>
            <li>{t("steps.devices")}</li>
            <li>{t("steps.link")}</li>
            <li>{t("steps.scan")}</li>
          </ol>
          {state === "qr" && status?.qrDataUrl && (
            <p className="wa-expiry">{t("expiresIn", { time: `${Math.floor(remainingMs / 60_000)}:${String(Math.floor(remainingMs / 1000) % 60).padStart(2, "0")}` })}</p>
          )}
        </div>
      ))}

      {state === "connected" && status && (
        <>
          <dl className="wa-stats">
            <div><dt>{t("sentMonthLabel")}</dt><dd>{t("sentMonth", { sent: status.sentThisMonth, limit: status.monthlyLimit })}</dd></div>
            <div><dt>{t("queuedLabel")}</dt><dd>{t("queued", { count: status.queued })}</dd></div>
          </dl>
          {confirmDisconnect ? (
            <div className="gdrive-confirm" role="group" aria-label={t("disconnectTitle")}>
              <p>{t("disconnectBody")}</p>
              <div>
                <button type="button" className="gdrive-danger" disabled={busy !== ""} onClick={() => void disconnect()}>{busy === "disconnect" ? t("disconnecting") : t("disconnectConfirm")}</button>
                <button type="button" className="gdrive-secondary" disabled={busy !== ""} onClick={() => setConfirmDisconnect(false)}>{t("cancel")}</button>
              </div>
            </div>
          ) : (
            <button type="button" className="gdrive-link gdrive-disconnect" disabled={busy !== ""} onClick={() => setConfirmDisconnect(true)}>
              <Unplug size={14} aria-hidden="true" /> {t("disconnect")}
            </button>
          )}
        </>
      )}

      {status?.configured && (
        <p className="wa-risk"><ShieldAlert size={15} aria-hidden="true" /> <span>{t("risk")}</span></p>
      )}
    </section>
  );
}
