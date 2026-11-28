import type { ReactNode } from "react";
import { LandingFooter } from "@/app/landing/footer";
import { LandingHeader } from "@/app/landing/header";
import "@/app/landing/landing.css";
import "./pricing.css";

export default function PricingPage({ hero, children }: { hero: ReactNode; children: ReactNode }) {
  return (
    <div className="lp-page bg-(--paper)!">
      <LandingHeader current="pricing" />
      <main className="app-shell pricing-shell">
        {hero}
        {children}
      </main>
      <LandingFooter />
    </div>
  );
}
