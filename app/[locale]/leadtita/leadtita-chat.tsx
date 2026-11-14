"use client";

import { useTranslations } from "next-intl";
import { LeadSuiteChat } from "@/app/[locale]/lead-suite/chat-panel";
import { useIntegrationFlash } from "@/lib/client/integration-flash";

const notices = { connected: "noticeConnected", denied: "noticeDenied", error: "noticeError", not_configured: "notConfigured" } as const;

/** Full-screen variant of the Lead Suite chat (same component, page suggestions) + one-shot Google OAuth result notice. */
export function LeadtitaChat() {
  const t = useTranslations("integrations");
  const flash = useIntegrationFlash("google");
  return (
    <>
      {flash && <p className="integrations-notice leadtita-flash" role="status" data-tone={flash.status === "connected" ? "ok" : "error"}>{t(notices[flash.status])}</p>}
      <LeadSuiteChat variant="page" />
    </>
  );
}
