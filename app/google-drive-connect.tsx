"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { FileSpreadsheet, FileText, LoaderCircle, Plus, RefreshCw, Unplug, X } from "lucide-react";
import { SiGmail, SiGooglecalendar, SiGoogledrive } from "react-icons/si";
import "./google-drive-connect.css";

export type ConnectedDriveFile = { id: string; name: string; mimeType: string; url: string; addedAt?: string };
export type GoogleFeatureName = "drive" | "gmail" | "calendar";
type Status = { configured: boolean; connected: boolean; email: string; files: ConnectedDriveFile[]; fullAccess: boolean; features: Record<GoogleFeatureName, boolean> };
type ReturnPath = "/integraciones" | "/leadtita";

// Estado compartido entre tarjetas: un solo /status en vuelo y aviso a todas cuando algo cambia (p. ej. desconectar).
const STATUS_EVENT = "leadta:google-status";
let statusRequest: Promise<Status> | null = null;
function fetchGoogleStatus(): Promise<Status> {
  statusRequest ??= fetch("/api/integrations/google/status", { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json() as Status;
      return { ...data, features: data.features ?? { drive: data.connected, gmail: false, calendar: false } };
    })
    .finally(() => { statusRequest = null; });
  return statusRequest;
}
function announceStatusChange() {
  window.dispatchEvent(new Event(STATUS_EVENT));
}

function connectHrefFor(feature: GoogleFeatureName, returnTo: ReturnPath, locale: string) {
  const params = new URLSearchParams({ returnTo: locale === "en" ? `/en${returnTo}` : returnTo });
  if (feature !== "drive") params.set("features", feature);
  return `/api/integrations/google/connect?${params}`;
}

const featureIcons = { drive: SiGoogledrive, gmail: SiGmail, calendar: SiGooglecalendar } as const;

// Tipos mínimos de Google Picker (script oficial, cargado bajo demanda).
type PickerDoc = { id: string };
type PickerData = { action: string; docs?: PickerDoc[] };
type PickerBuilder = {
  addView(view: unknown): PickerBuilder; enableFeature(feature: unknown): PickerBuilder; setAppId(id: string): PickerBuilder;
  setOAuthToken(token: string): PickerBuilder; setDeveloperKey(key: string): PickerBuilder; setLocale(locale: string): PickerBuilder;
  setCallback(cb: (data: PickerData) => void): PickerBuilder; build(): { setVisible(visible: boolean): void };
};
type GooglePicker = {
  PickerBuilder: new () => PickerBuilder;
  DocsView: new (viewId?: unknown) => { setMimeTypes(types: string): unknown; setIncludeFolders(value: boolean): unknown };
  ViewId: { DOCS: unknown };
  Feature: { MULTISELECT_ENABLED: unknown };
  Action: { PICKED: string; CANCEL: string };
};
type PickerWindow = Window & { gapi?: { load(name: string, cb: () => void): void }; google?: { picker?: GooglePicker } };

const PICKER_MIME_TYPES = "application/vnd.google-apps.spreadsheet,application/vnd.google-apps.document,text/csv,application/pdf,text/markdown,text/plain";
let pickerScript: Promise<GooglePicker> | null = null;

/** Carga perezosa de https://apis.google.com/js/api.js + módulo picker; una sola vez por pestaña. */
function loadPicker(): Promise<GooglePicker> {
  const w = window as PickerWindow;
  if (w.google?.picker) return Promise.resolve(w.google.picker);
  pickerScript ??= new Promise<GooglePicker>((resolve, reject) => {
    const onApi = () => w.gapi?.load("picker", () => (w.google?.picker ? resolve(w.google.picker) : reject(new Error("picker"))));
    if (w.gapi) return onApi();
    const script = document.createElement("script");
    script.src = "https://apis.google.com/js/api.js";
    script.async = true;
    script.onload = onApi;
    script.onerror = () => { pickerScript = null; reject(new Error("script")); };
    document.head.appendChild(script);
  });
  return pickerScript;
}

const isSheet = (mime: string) => mime === "application/vnd.google-apps.spreadsheet" || mime === "text/csv";

/**
 * Tarjeta de Google Drive: conectar, estado, Picker y archivos conectados. Reutilizable (página /integraciones y el "+" de Leadtita).
 * `returnTo`: adónde vuelve el OAuth (/leadtita o /integraciones). `onFilesChange`: avisa la lista vigente de archivos.
 */
export function GoogleDriveConnect({ returnTo = "/integraciones", onFilesChange, onPicked, compact = false }: { returnTo?: "/integraciones" | "/leadtita"; onFilesChange?: (files: ConnectedDriveFile[]) => void; onPicked?: (files: ConnectedDriveFile[]) => void; compact?: boolean }) {
  const t = useTranslations("integrations");
  const locale = useLocale();
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"" | "picker" | "disconnect" | string>("");
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const onFilesRef = useRef(onFilesChange);
  const onPickedRef = useRef(onPicked);
  useEffect(() => { onFilesRef.current = onFilesChange; onPickedRef.current = onPicked; });

  const apply = useCallback((next: Status) => {
    setStatus(next);
    onFilesRef.current?.(next.files);
  }, []);

  const load = useCallback(async () => {
    setError("");
    try {
      apply(await fetchGoogleStatus());
    } catch {
      setError(t("loadError"));
    }
  }, [apply, t]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial del estado
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const onChange = () => void load();
    window.addEventListener(STATUS_EVENT, onChange);
    return () => window.removeEventListener(STATUS_EVENT, onChange);
  }, [load]);

  const pickerKey = process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY ?? "";
  const appId = process.env.NEXT_PUBLIC_GOOGLE_APP_ID ?? "";

  async function openPicker() {
    if (!status) return;
    setBusy("picker");
    setError("");
    try {
      const [picker, tokenResponse] = await Promise.all([loadPicker(), fetch("/api/integrations/google/picker-token", { cache: "no-store" })]);
      if (tokenResponse.status === 409) { await load(); throw new Error("not_connected"); }
      const { accessToken } = await tokenResponse.json() as { accessToken?: string };
      if (!accessToken) throw new Error("token");
      const view = new picker.DocsView(picker.ViewId.DOCS);
      view.setMimeTypes(PICKER_MIME_TYPES);
      view.setIncludeFolders(true);
      new picker.PickerBuilder()
        .addView(view)
        .enableFeature(picker.Feature.MULTISELECT_ENABLED)
        .setAppId(appId)
        .setOAuthToken(accessToken)
        .setDeveloperKey(pickerKey)
        .setLocale(document.documentElement.lang || "es")
        .setCallback((data) => {
          if (data.action === picker.Action.PICKED && data.docs?.length) void addPicked(data.docs.map((doc) => doc.id));
        })
        .build()
        .setVisible(true);
    } catch {
      setError(t("pickerError"));
    } finally {
      setBusy("");
    }
  }

  async function addPicked(ids: string[]) {
    setBusy("picker");
    try {
      const response = await fetch("/api/integrations/google/files", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: ids.slice(0, 20) }) });
      const payload = await response.json().catch(() => ({})) as { files?: ConnectedDriveFile[]; rejected?: number };
      if (!response.ok || !payload.files) throw new Error(String(response.status));
      if (status) apply({ ...status, files: payload.files });
      onPickedRef.current?.(payload.files.filter((file) => ids.includes(file.id)));
      if (payload.rejected) setError(t("someRejected", { count: payload.rejected }));
    } catch {
      setError(t("addError"));
    } finally {
      setBusy("");
    }
  }

  async function removeFile(file: ConnectedDriveFile) {
    setBusy(file.id);
    setError("");
    try {
      const response = await fetch(`/api/integrations/google/files/${encodeURIComponent(file.id)}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({})) as { files?: ConnectedDriveFile[] };
      if (!response.ok || !payload.files) throw new Error(String(response.status));
      if (status) apply({ ...status, files: payload.files });
    } catch {
      setError(t("removeError"));
    } finally {
      setBusy("");
    }
  }

  async function disconnect() {
    setBusy("disconnect");
    setError("");
    try {
      const response = await fetch("/api/integrations/google/disconnect", { method: "POST" });
      if (!response.ok) throw new Error(String(response.status));
      setConfirmDisconnect(false);
      announceStatusChange();
    } catch {
      setError(t("disconnectError"));
    } finally {
      setBusy("");
    }
  }

  const connectHref = connectHrefFor("drive", returnTo, locale);

  return (
    <section className={`gdrive-card${compact ? " gdrive-card-compact" : ""}`} aria-labelledby="gdrive-title" aria-busy={!status}>
      <header className="gdrive-head">
        <span className="gdrive-logo" aria-hidden="true"><SiGoogledrive size={20} /></span>
        <div className="gdrive-head-text">
          <h2 id="gdrive-title">Google Drive</h2>
          <p>{status?.connected ? t("connectedAs", { email: status.email || "Google" }) : t("description")}</p>
        </div>
        {status?.connected && <span className="gdrive-badge">{t("connected")}</span>}
      </header>

      {!status && !error && <p className="gdrive-state" role="status"><LoaderCircle className="gdrive-spin" size={16} aria-hidden="true" /> {t("loading")}</p>}
      {error && (
        <p className="gdrive-error" role="alert">
          {error}
          {!status && <button type="button" className="gdrive-link" onClick={() => void load()}><RefreshCw size={14} aria-hidden="true" /> {t("retry")}</button>}
        </p>
      )}

      {status && !status.configured && <p className="gdrive-state">{t("notConfigured")}</p>}

      {status?.configured && !status.connected && (
        <div className="gdrive-actions">
          <a className="gdrive-primary" href={connectHref}><SiGoogledrive size={16} aria-hidden="true" /> {t("connect")}</a>
          <p className="gdrive-hint">{status.fullAccess ? t("hintFull") : t("hintFiles")}</p>
        </div>
      )}

      {status?.configured && status.connected && (
        <>
          <div className="gdrive-actions">
            <button type="button" className="gdrive-primary" disabled={busy === "picker" || !pickerKey || !appId} onClick={() => void openPicker()}>
              {busy === "picker" ? <LoaderCircle className="gdrive-spin" size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />} {t("pickFiles")}
            </button>
            {(!pickerKey || !appId) && <p className="gdrive-hint">{t("pickerNotConfigured")}</p>}
          </div>

          {status.files.length ? (
            <ul className="gdrive-files" aria-label={t("filesLabel")}>
              {status.files.map((file) => (
                <li key={file.id}>
                  {isSheet(file.mimeType) ? <FileSpreadsheet size={16} aria-hidden="true" /> : <FileText size={16} aria-hidden="true" />}
                  {file.url ? <a href={file.url} target="_blank" rel="noopener noreferrer">{file.name}</a> : <span>{file.name}</span>}
                  <button type="button" className="gdrive-icon-button" disabled={busy === file.id} onClick={() => void removeFile(file)} aria-label={t("removeFile", { name: file.name })}>
                    {busy === file.id ? <LoaderCircle className="gdrive-spin" size={14} aria-hidden="true" /> : <X size={14} aria-hidden="true" />}
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="gdrive-state">{t("noFiles")}</p>}

          {confirmDisconnect ? (
            <div className="gdrive-confirm" role="group" aria-label={t("disconnectTitle")}>
              <p>{t("disconnectBody")}</p>
              <div>
                <button type="button" className="gdrive-danger" disabled={busy === "disconnect"} onClick={() => void disconnect()}>{busy === "disconnect" ? t("disconnecting") : t("disconnectConfirm")}</button>
                <button type="button" className="gdrive-secondary" disabled={busy === "disconnect"} onClick={() => setConfirmDisconnect(false)}>{t("cancel")}</button>
              </div>
            </div>
          ) : (
            <button type="button" className="gdrive-link gdrive-disconnect" onClick={() => setConfirmDisconnect(true)}><Unplug size={14} aria-hidden="true" /> {t("disconnect")}</button>
          )}
        </>
      )}
    </section>
  );
}

/**
 * Botón reutilizable para pedir un permiso de Google (consentimiento incremental).
 * Leadtita lo muestra cuando falta Gmail o Calendar: `<GoogleFeatureConnectButton feature="gmail" returnTo="/leadtita" />`.
 */
export function GoogleFeatureConnectButton({ feature, returnTo = "/leadtita", className = "gdrive-primary" }: { feature: GoogleFeatureName; returnTo?: ReturnPath; className?: string }) {
  const t = useTranslations("integrations");
  const locale = useLocale();
  const Icon = featureIcons[feature];
  return (
    <a className={className} href={connectHrefFor(feature, returnTo, locale)}>
      <Icon size={16} aria-hidden="true" /> {t(`features.${feature}.connect`)}
    </a>
  );
}

/** Tarjeta de Gmail o Calendar en /integraciones: qué permite, estado, conectar y desconectar (desconecta toda la cuenta de Google). */
export function GoogleFeatureCard({ feature, returnTo = "/integraciones" }: { feature: Exclude<GoogleFeatureName, "drive">; returnTo?: ReturnPath }) {
  const t = useTranslations("integrations");
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const Icon = featureIcons[feature];
  const titleId = `gfeature-${feature}-title`;

  const load = useCallback(async () => {
    setError("");
    try {
      setStatus(await fetchGoogleStatus());
    } catch {
      setError(t("loadError"));
    }
  }, [t]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial del estado
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const onChange = () => void load();
    window.addEventListener(STATUS_EVENT, onChange);
    return () => window.removeEventListener(STATUS_EVENT, onChange);
  }, [load]);

  async function disconnect() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/integrations/google/disconnect", { method: "POST" });
      if (!response.ok) throw new Error(String(response.status));
      setConfirm(false);
      announceStatusChange();
    } catch {
      setError(t("disconnectError"));
    } finally {
      setBusy(false);
    }
  }

  const granted = Boolean(status?.features[feature]);
  return (
    <section className="gdrive-card" aria-labelledby={titleId} aria-busy={!status}>
      <header className="gdrive-head">
        <span className="gdrive-logo" aria-hidden="true"><Icon size={20} /></span>
        <div className="gdrive-head-text">
          <h2 id={titleId}>{t(`features.${feature}.title`)}</h2>
          <p>{granted && status?.email ? t("connectedAs", { email: status.email }) : t(`features.${feature}.description`)}</p>
        </div>
        {granted && <span className="gdrive-badge">{t("connected")}</span>}
      </header>

      {!status && !error && <p className="gdrive-state" role="status"><LoaderCircle className="gdrive-spin" size={16} aria-hidden="true" /> {t("loading")}</p>}
      {error && (
        <p className="gdrive-error" role="alert">
          {error}
          {!status && <button type="button" className="gdrive-link" onClick={() => void load()}><RefreshCw size={14} aria-hidden="true" /> {t("retry")}</button>}
        </p>
      )}
      {status && !status.configured && <p className="gdrive-state">{t("notConfigured")}</p>}

      {status?.configured && !granted && (
        <div className="gdrive-actions">
          <GoogleFeatureConnectButton feature={feature} returnTo={returnTo} />
          <p className="gdrive-hint">{t(`features.${feature}.hint`)}</p>
        </div>
      )}

      {status?.configured && granted && (confirm ? (
        <div className="gdrive-confirm" role="group" aria-label={t("disconnectTitle")}>
          <p>{t("disconnectBody")}</p>
          <div>
            <button type="button" className="gdrive-danger" disabled={busy} onClick={() => void disconnect()}>{busy ? t("disconnecting") : t("disconnectConfirm")}</button>
            <button type="button" className="gdrive-secondary" disabled={busy} onClick={() => setConfirm(false)}>{t("cancel")}</button>
          </div>
        </div>
      ) : (
        <>
          <p className="gdrive-hint">{t(`features.${feature}.hint`)}</p>
          <button type="button" className="gdrive-link gdrive-disconnect" onClick={() => setConfirm(true)}><Unplug size={14} aria-hidden="true" /> {t("disconnect")}</button>
        </>
      ))}
    </section>
  );
}
