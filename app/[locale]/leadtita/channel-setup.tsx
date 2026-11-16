"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { GoogleFeatureCard } from "@/app/google-drive-connect";
import { WhatsAppConnectCard } from "@/app/whatsapp-connect";

export type SetupChannels = { whatsapp: boolean; gmail: boolean; needed: boolean };

// "Skip" hides it until the next browser session; "don't show again" hides it on this browser for good.
const SKIP_KEY = "leadta:channel-setup-skipped";
const HIDE_KEY = "leadta:channel-setup-hidden";
const CHECK_TIMEOUT_MS = 3000;

function setupDismissed() {
  try {
    return localStorage.getItem(HIDE_KEY) === "1" || sessionStorage.getItem(SKIP_KEY) === "1";
  } catch {
    return false;
  }
}

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: "no-store", signal });
  if (!response.ok) throw new Error(String(response.status));
  return await response.json() as T;
}

/** Which channels are available (configured) and whether any of them still needs connecting. Errors count as "nothing to set up". */
export async function checkChannelSetup(): Promise<SetupChannels> {
  const none = { whatsapp: false, gmail: false, needed: false };
  if (setupDismissed()) return none;
  const signal = AbortSignal.timeout(CHECK_TIMEOUT_MS);
  const [wa, google] = await Promise.allSettled([
    getJson<{ configured: boolean; status: string }>("/api/integrations/whatsapp/status", signal),
    getJson<{ configured: boolean; features?: { gmail?: boolean } }>("/api/integrations/google/status", signal),
  ]);
  const waOk = wa.status === "fulfilled" && wa.value.configured;
  const gmailOk = google.status === "fulfilled" && google.value.configured;
  const needed = (waOk && wa.value.status !== "connected") || (gmailOk && !google.value.features?.gmail);
  return { whatsapp: waOk, gmail: gmailOk, needed };
}

/** First screen of /leadtita while WhatsApp or Gmail are available but not connected. Reuses the integration cards. */
export function ChannelSetup({ channels, onDone }: { channels: SetupChannels; onDone: () => void }) {
  const t = useTranslations("integrations.setup");
  const [never, setNever] = useState(false);
  const [allConnected, setAllConnected] = useState(false);

  // The cards announce changes (WhatsApp linked, Google disconnected): recheck to switch the button to "Go to Leadtita".
  useEffect(() => {
    let active = true;
    const recheck = () => void checkChannelSetup().then((next) => { if (active) setAllConnected(!next.needed); });
    window.addEventListener("leadta:whatsapp-status", recheck);
    window.addEventListener("leadta:google-status", recheck);
    return () => {
      active = false;
      window.removeEventListener("leadta:whatsapp-status", recheck);
      window.removeEventListener("leadta:google-status", recheck);
    };
  }, []);

  function finish() {
    if (!allConnected) {
      try {
        if (never) localStorage.setItem(HIDE_KEY, "1");
        else sessionStorage.setItem(SKIP_KEY, "1");
      } catch { /* storage blocked: the screen just shows again next time */ }
    }
    onDone();
  }

  return (
    <section className="channel-setup" aria-labelledby="channel-setup-title">
      <header className="channel-setup__head">
        <span className="brand channel-setup__logo" aria-hidden="true">Leadta<span className="brand-period">.</span></span>
        <h1 id="channel-setup-title">{t("title")}</h1>
        <p>{t("lede")}</p>
      </header>
      <div className="channel-setup__cards">
        {channels.whatsapp && <WhatsAppConnectCard />}
        {channels.gmail && <GoogleFeatureCard feature="gmail" returnTo="/leadtita" />}
      </div>
      <div className="channel-setup__footer">
        {!allConnected && (
          <label className="channel-setup__never">
            <input type="checkbox" checked={never} onChange={(event) => setNever(event.target.checked)} /> {t("never")}
          </label>
        )}
        <button type="button" className={allConnected ? "gdrive-primary" : "gdrive-secondary"} onClick={finish}>{allConnected ? t("done") : t("continue")}</button>
      </div>
    </section>
  );
}
