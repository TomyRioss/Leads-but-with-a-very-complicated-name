"use client";

import { useEffect } from "react";
import { AppSidebar } from "@/app/app-sidebar";
import type { ComponentProps } from "react";
import { useRouter } from "@/i18n/navigation";
import { getSession, invalidateSession, useCachedSidebarUser } from "@/lib/client/session";

/** AppSidebar con la sesión resuelta en el cliente vía getSession (lib/client/session.ts); lo usan Lead Suite y Leadtita (`active`). */
export function LeadSuiteSidebar({ active = "leadSuite" }: { active?: ComponentProps<typeof AppSidebar>["active"] }) {
  const router = useRouter();
  const [user, setUser] = useCachedSidebarUser();

  useEffect(() => {
    let current = true;
    getSession()
      .then((payload) => {
        if (!current) return;
        if (!payload.user) router.replace("/");
        else setUser({ email: String(payload.user.email), credits: Number(payload.user.credits) || 0 });
      })
      .catch(() => undefined);
    return () => { current = false; };
  }, [router, setUser]);

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    invalidateSession();
    router.replace("/");
  }

  // Always mounted: skeleton while the session loads, so the layout never jumps.
  return <AppSidebar active={active} user={user} onSignOut={signOut} />;
}
