"use client";

import { useEffect, useState } from "react";
import { INTEGRATION_FLASH_COOKIE, parseIntegrationFlash, type IntegrationFlash } from "@/lib/integration-flash";

// Legacy result params (?google=...) from before the flash cookie; stripped silently.
const LEGACY_PARAMS = ["google"];

/** Reads the integration flash once and deletes it immediately; also cleans legacy params from the URL. */
export function takeIntegrationFlash(): IntegrationFlash | null {
  const url = new URL(window.location.href);
  if (LEGACY_PARAMS.some((name) => url.searchParams.has(name))) {
    LEGACY_PARAMS.forEach((name) => url.searchParams.delete(name));
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }
  const raw = document.cookie.split("; ").find((item) => item.startsWith(`${INTEGRATION_FLASH_COOKIE}=`))?.slice(INTEGRATION_FLASH_COOKIE.length + 1);
  if (raw === undefined) return null;
  document.cookie = `${INTEGRATION_FLASH_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
  return parseIntegrationFlash(decodeURIComponent(raw));
}

/** Flash for `provider` taken on mount (null until then / when there is none). Reloading never shows it again. */
export function useIntegrationFlash(provider: string): IntegrationFlash | null {
  const [flash, setFlash] = useState<IntegrationFlash | null>(null);
  useEffect(() => {
    const taken = takeIntegrationFlash();
    // ponytail: a flash for another provider is consumed and dropped; route by provider when a 2nd one ships.
    // Deferred: the cookie is an external store read once on mount (avoids a sync setState in the effect body).
    if (taken?.provider === provider) queueMicrotask(() => setFlash(taken));
  }, [provider]);
  return flash;
}
