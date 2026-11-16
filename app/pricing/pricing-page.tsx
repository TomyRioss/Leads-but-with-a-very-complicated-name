"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { BrandLogo } from "@/app/brand-logo";
import { LanguageSwitcher } from "@/app/language-switcher";
import { getSession } from "@/lib/client/session";
import "./pricing.css";

const noSubscribe = () => () => undefined;

export default function PricingPage({ hero, children }: { hero: ReactNode; children: ReactNode }) {
  const t = useTranslations("Pricing");
  const [member, setMember] = useState(false);
  // Back from the Mercado Pago checkout (back_url ?subscription=return): credits land when MP confirms the charge.
  const returned = useSyncExternalStore(noSubscribe, () => new URLSearchParams(window.location.search).get("subscription") === "return", () => false);

  useEffect(() => {
    let active = true;
    getSession()
      .then((payload) => { if (active) setMember(Boolean(payload.user)); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  return (
    <main className="app-shell pricing-shell">
      <nav className="topbar" aria-label={t("navLabel")}>
        <BrandLogo />
        <div className="topbar-actions"><LanguageSwitcher /><Link className="pricing-nav-link" href={member ? "/buscar" : "/login"}>{member ? t("goToLeadta") : t("session")}</Link></div>
      </nav>

      {returned ? <p className="price-return" role="status">{t("returnNotice")}</p> : null}
      {hero}
      {children}
    </main>
  );
}
