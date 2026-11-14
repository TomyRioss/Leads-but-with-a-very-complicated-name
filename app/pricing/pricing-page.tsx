"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { BrandLogo } from "@/app/brand-logo";
import { LanguageSwitcher } from "@/app/language-switcher";
import { getSession } from "@/lib/client/session";
import "./pricing.css";

export default function PricingPage({ hero, children }: { hero: ReactNode; children: ReactNode }) {
  const t = useTranslations("Pricing");
  const [member, setMember] = useState(false);

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
        <div className="topbar-actions"><LanguageSwitcher /><Link className="pricing-nav-link" href="/buscar">{member ? t("goToLeadta") : t("session")}</Link></div>
      </nav>

      {hero}
      {children}
    </main>
  );
}
