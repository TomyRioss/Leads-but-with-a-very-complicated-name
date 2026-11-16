"use client";

import { useEffect } from "react";
import { useLocale } from "next-intl";
import { AuthForm } from "@/app/auth-form";
import { getPathname } from "@/i18n/navigation";
import { getSession } from "@/lib/client/session";

/** /login and /register: the same AuthForm /buscar shows as its gate, with a real URL per mode. */
export function AuthPage({ mode }: { mode: "login" | "register" }) {
  const locale = useLocale();
  const app = getPathname({ href: "/buscar", locale });
  const paths = { login: getPathname({ href: "/login", locale }), register: getPathname({ href: "/register", locale }) };

  // Already signed in: straight to the app.
  useEffect(() => {
    void getSession().then((session) => { if (session.user) window.location.replace(app); });
  }, [app]);

  // Full navigation (like /buscar's reload) so the app starts from the new session cookie.
  return <AuthForm initialMode={mode} paths={paths} onAuthenticated={() => window.location.assign(app)} />;
}
