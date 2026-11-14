"use client";

import { useTranslations } from "next-intl";
import { GoogleDriveConnect, GoogleFeatureCard } from "@/app/google-drive-connect";
import { useIntegrationFlash } from "@/lib/client/integration-flash";

const notices = { connected: "noticeConnected", denied: "noticeDenied", error: "noticeError", not_configured: "notConfigured" } as const;

/** Aviso del resultado del OAuth (flash cookie, una sola vez) + tarjetas de Google Drive, Gmail y Calendar. */
export function IntegrationsView() {
  const t = useTranslations("integrations");
  const result = useIntegrationFlash("google")?.status ?? null;
  const key = result ? notices[result] : null;
  return (
    <>
      {key && <p className="integrations-notice" role="status" data-tone={result === "connected" ? "ok" : "error"}>{t(key)}</p>}
      <div className="integrations-grid">
        <GoogleDriveConnect returnTo="/integraciones" />
        <GoogleFeatureCard feature="gmail" />
        <GoogleFeatureCard feature="calendar" />
      </div>
    </>
  );
}
