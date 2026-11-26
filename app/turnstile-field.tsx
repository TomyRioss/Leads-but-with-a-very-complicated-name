"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { preload } from "react-dom";
import { LoaderCircle } from "lucide-react";

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

export type TurnstileFieldHandle = {
  reset: () => void;
  /** Current token, or waits for Turnstile to issue one. Resolves "" on error or after `timeoutMs`. */
  waitForToken: (timeoutMs: number) => Promise<string>;
};

/**
 * Cloudflare Turnstile widget. It adds a hidden `cf-turnstile-response` input to the enclosing form; the server
 * verifies it on signup/login. The script is preloaded from the server-rendered HTML so it downloads while the
 * page hydrates; `placeholder` holds the widget's space until Cloudflare renders it.
 */
export const TurnstileField = forwardRef<TurnstileFieldHandle, { locale: string; appearance?: "always" | "interaction-only"; placeholder?: string }>(function TurnstileField({ locale, appearance = "always", placeholder }, ref) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const token = useRef("");
  const waiters = useRef(new Set<(value: string) => void>());
  const [rendered, setRendered] = useState(false);
  if (siteKey) preload(SCRIPT_SRC, { as: "script" });

  useImperativeHandle(ref, () => ({
    reset: () => {
      token.current = "";
      if (widgetId.current) window.turnstile?.reset(widgetId.current);
    },
    waitForToken: (timeoutMs) => {
      if (token.current) return Promise.resolve(token.current);
      return new Promise<string>((resolve) => {
        const done = (value: string) => { clearTimeout(timer); waiters.current.delete(done); resolve(value); };
        const timer = setTimeout(() => done(""), timeoutMs);
        waiters.current.add(done);
      });
    },
  }), []);

  useEffect(() => {
    if (!siteKey) return;
    let active = true;
    const settle = (value: string) => {
      token.current = value;
      for (const done of [...waiters.current]) done(value);
    };
    void loadTurnstile().then((turnstile) => {
      if (!active || !container.current || widgetId.current) return;
      widgetId.current = turnstile.render(container.current, {
        sitekey: siteKey,
        language: locale === "en" ? "en" : "es",
        theme: "light",
        size: "flexible",
        appearance,
        "response-field-name": "cf-turnstile-response",
        callback: settle,
        "expired-callback": () => { token.current = ""; },
        "error-callback": () => settle(""),
      });
      setRendered(true);
    }).catch(() => settle(""));
    return () => {
      active = false;
      if (widgetId.current) window.turnstile?.remove(widgetId.current);
      widgetId.current = null;
      token.current = "";
      setRendered(false);
    };
  }, [locale, appearance]);

  return (
    <div className="turnstile-field">
      <div ref={container} />
      {placeholder && siteKey && !rendered && (
        <p className="m-0 flex min-h-[65px] items-center gap-2 rounded-[7px] border border-(--line) bg-(--paper) px-4 text-xs text-(color:--muted)" role="status">
          <LoaderCircle className="animate-spin" size={16} aria-hidden="true" />
          {placeholder}
        </p>
      )}
    </div>
  );
});
