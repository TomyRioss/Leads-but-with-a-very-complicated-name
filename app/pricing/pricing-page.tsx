"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { BrandLogo } from "@/app/brand-logo";

export default function PricingPage({ hero, children }: { hero: ReactNode; children: ReactNode }) {
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
        <Link className="pricing-nav-link" href="/buscar">{member ? "Ir a Leadta" : "Iniciar sesión"}</Link>
      </nav>

      {hero}
      {children}
    </main>
  );
}
