"use client";

import { useTranslations } from "next-intl";
import { GoogleDriveConnect, GoogleFeatureCard } from "@/app/google-drive-connect";
import { WhatsAppConnectCard } from "@/app/whatsapp-connect";
import { useIntegrationFlash } from "@/lib/client/integration-flash";

const notices = { connected: "noticeConnected", denied: "noticeDenied", error: "noticeError", not_configured: "notConfigured" } as const;

/**
 * Aviso del resultado del OAuth (flash cookie, una sola vez) + tarjetas de Google Drive, Gmail, Calendar y WhatsApp.
 * `returnTo`: adónde vuelve el OAuth de Google (la página o Leadtita, cuando se abre como modal desde el chat).
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
      </div>
    </>
  );
}
