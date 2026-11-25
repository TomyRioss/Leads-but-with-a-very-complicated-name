"use client";

import { useCallback, useEffect, useRef } from "react";
import { useLocale } from "next-intl";
import { AuthForm } from "@/app/auth-form";
import { getPathname } from "@/i18n/navigation";
import { getSession } from "@/lib/client/session";

/**
 * `?next=` return path: only same-origin relative paths ("/…", never "//…" or with backslashes or control chars).
 * Anything else is ignored and the user lands on /leadtita.
 */
function safeNextPath(value: string | null): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 32 || code === 127) return null;
  }
  try {
    const url = new URL(value, window.location.origin);
    return url.origin === window.location.origin ? `${url.pathname}${url.search}${url.hash}` : null;
  } catch {
    return null;
  }
}

/** /login and /register: the same AuthForm /buscar shows as its gate, with a real URL per mode. */
export function AuthPage({ mode }: { mode: "login" | "register" }) {
  const locale = useLocale();
  const app = getPathname({ href: "/leadtita", locale });
  const paths = { login: getPathname({ href: "/login", locale }), register: getPathname({ href: "/register", locale }) };
  // Read once on mount: switching login/register rewrites the URL and drops the query.
  const next = useRef<string | null>(null);

  // Destino al entrar: ?next= manda; si no, un negocio con onboarding pendiente (p. ej. recién traído de /explorar); si no, la app.
  const home = useCallback(async () => {
    if (next.current) return next.current;
    const pending = await fetch("/api/onboarding/pending", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null) as { businessId?: unknown } | null;
    return typeof pending?.businessId === "string" && pending.businessId
      ? getPathname({ href: { pathname: "/onboarding", query: { business: pending.businessId } }, locale })
      : app;
  }, [app, locale]);

  // Already signed in: straight to the app (or the requested return path).
  useEffect(() => {
    next.current = safeNextPath(new URLSearchParams(window.location.search).get("next"));
    void getSession().then(async (session) => { if (session.user) window.location.replace(await home()); });
  }, [home]);

  // Full navigation (like /buscar's reload) so the app starts from the new session cookie.
  return <AuthForm initialMode={mode} paths={paths} onAuthenticated={() => void home().then((path) => window.location.assign(path))} />;
}
