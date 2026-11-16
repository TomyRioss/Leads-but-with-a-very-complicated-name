"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

type TurnstileApi = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId: string) => void;
};
declare global {
  interface Window { turnstile?: TurnstileApi }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
// Cloudflare's official "always passes" test site key, used only when no key is configured outside production.
const TEST_SITE_KEY = "1x00000000000000000000AA";
const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || (process.env.NODE_ENV === "production" ? "" : TEST_SITE_KEY);

let scriptPromise: Promise<TurnstileApi> | null = null;
function loadTurnstile() {
  scriptPromise ??= new Promise<TurnstileApi>((resolve, reject) => {
    if (window.turnstile) return resolve(window.turnstile);
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile")));
    script.onerror = () => { scriptPromise = null; reject(new Error("turnstile")); };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export type TurnstileFieldHandle = { reset: () => void };

/**
 * Cloudflare Turnstile widget. It adds a hidden `cf-turnstile-response` input to the enclosing form; the server
 * verifies it on signup/login. The script loads only when the auth form mounts.
 */
export const TurnstileField = forwardRef<TurnstileFieldHandle, { locale: string }>(function TurnstileField({ locale }, ref) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  useImperativeHandle(ref, () => ({ reset: () => { if (widgetId.current) window.turnstile?.reset(widgetId.current); } }), []);

  useEffect(() => {
    if (!siteKey) return;
    let active = true;
    void loadTurnstile().then((turnstile) => {
      if (!active || !container.current || widgetId.current) return;
      widgetId.current = turnstile.render(container.current, {
        sitekey: siteKey,
        language: locale === "en" ? "en" : "es",
        theme: "light",
        size: "flexible",
        "response-field-name": "cf-turnstile-response",
      });
    }).catch(() => undefined);
    return () => {
      active = false;
      if (widgetId.current) window.turnstile?.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [locale]);

  return <div ref={container} className="turnstile-field" />;
});
