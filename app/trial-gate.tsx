"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { CircleAlert } from "lucide-react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { getSession } from "@/lib/client/session";

// Pages that need an account. An expired trial (lib/trial.ts) can only reach /pricing to pay.
const PRIVATE = ["/lead-suite", "/leadtita", "/onboarding", "/negocios", "/campanas", "/propuestas", "/historial", "/integraciones", "/oauth/authorize"];

/** Sends an expired-trial account from a private page to /pricing and shows why there. Public pages make no request. */
export function TrialGate() {
  const t = useTranslations("Trial");
  const pathname = usePathname();
  const router = useRouter();
  const [expired, setExpired] = useState(false);
  const onPricing = pathname === "/pricing";
  const watch = onPricing || PRIVATE.some((path) => pathname === path || pathname.startsWith(`${path}/`));

  useEffect(() => {
    if (!watch) return;
    let ignore = false;
    getSession().then((session) => {
      if (ignore) return;
      const over = session.user?.access === "expired";
      setExpired(over);
      if (over && !onPricing) router.replace("/pricing");
    }, () => {});
    return () => { ignore = true; };
  }, [watch, onPricing, router]);

  if (!expired || !onPricing) return null;
  return (
    <div role="status" className="border-b border-(color:--line) bg-(--lime) px-4 py-3 text-center text-sm font-semibold text-(color:--ash-950)">
      <span className="inline-flex items-center gap-2"><CircleAlert size={16} aria-hidden="true" />{t("ended")}</span>
    </div>
  );
}
