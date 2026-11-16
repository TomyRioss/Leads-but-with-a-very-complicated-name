"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { LeadSuiteChat } from "@/app/[locale]/lead-suite/chat-panel";
import { useIntegrationFlash } from "@/lib/client/integration-flash";
import { ChannelSetup, checkChannelSetup, type SetupChannels } from "./channel-setup";
import { LeadsSidebar } from "./leads-sidebar";
import { LeadtitaOnboarding } from "@/app/onboarding/leadtita-onboarding";

const notices = { connected: "noticeConnected", denied: "noticeDenied", error: "noticeError", not_configured: "notConfigured" } as const;

/** Full-screen variant of the Lead Suite chat (same component, page suggestions) + one-shot Google OAuth result notice.
 * Before the chat, a setup screen while WhatsApp or Gmail are available but not connected. */
export function LeadtitaChat() {
  const t = useTranslations("integrations");
  const flash = useIntegrationFlash("google");
  // null = still checking (max ~3 s, see checkChannelSetup).
  const [setup, setSetup] = useState<SetupChannels | null>(null);

  useEffect(() => {
    let active = true;
    void checkChannelSetup().then((channels) => { if (active) setSetup(channels); });
    return () => { active = false; };
  }, []);

  return (
    <>
      {flash && <p className="integrations-notice leadtita-flash" role="status" data-tone={flash.status === "connected" ? "ok" : "error"}>{t(notices[flash.status])}</p>}
      {setup?.needed
        ? <ChannelSetup channels={setup} onDone={() => setSetup({ ...setup, needed: false })} />
        : setup ? <><LeadSuiteChat variant="page" /><LeadsSidebar /></> : null}
      <LeadtitaOnboarding ready={Boolean(setup && !setup.needed)} />
    </>
  );
}
