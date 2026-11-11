"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { BrandLogo } from "@/app/brand-logo";
import { LanguageSwitcher } from "@/app/language-switcher";

export default function PricingPage({ hero, children, locale }: { hero: ReactNode; children: ReactNode; locale: string }) {
  const [member, setMember] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/me", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() : null)
      .then((payload) => { if (active) setMember(Boolean(payload?.user)); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  return (
    <main className="app-shell pricing-shell">
      <nav className="topbar" aria-label="Navegación principal">
        <BrandLogo />
        <div className="topbar-actions"><LanguageSwitcher /><Link className="pricing-nav-link" href="/buscar">{member ? (locale === "en" ? "Go to Leadta" : "Ir a Leadta") : (locale === "en" ? "Sign in" : "Iniciar sesión")}</Link></div>
      </nav>

      {hero}
      {children}
    </main>
  );
}
