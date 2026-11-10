"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BrandLogo } from "@/app/brand-logo";
import { PricingHero } from "@/app/pricing-hero";
import { subscriptionPlans } from "@/lib/plans";

type SessionState = "loading" | "guest" | "member";
type SubscriptionSummary = { id: string; planId: string; status: string; priceArs: number; monthlyCredits: number; checkoutUrl: string };

export default function PricingPage() {
  const [session, setSession] = useState<SessionState>("loading");
  const [currentSubscription, setCurrentSubscription] = useState<SubscriptionSummary | null>(null);
  const [subscriptionBusy, setSubscriptionBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/auth/me", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() : null)
      .then(async (payload) => {
        if (!active) return;
        if (!payload?.user) {
          setSession("guest");
          return;
        }
        setSession("member");
        const currentResponse = await fetch("/api/subscriptions/current", { cache: "no-store" });
        const currentPayload = currentResponse.ok ? await currentResponse.json() : null;
        if (active && currentPayload?.subscription) setCurrentSubscription(currentPayload.subscription);

        const subscriptionId = new URLSearchParams(window.location.search).get("subscription");
        if (subscriptionId) {
          for (let attempt = 0; attempt < 5 && active; attempt++) {
            const statusResponse = await fetch(`/api/subscriptions/${encodeURIComponent(subscriptionId)}`, { cache: "no-store" });
            const statusPayload = statusResponse.ok ? await statusResponse.json() : null;
            if (statusPayload?.subscription) {
              setCurrentSubscription(statusPayload.subscription);
              if (!["creating", "pending"].includes(statusPayload.subscription.status)) break;
            }
            await new Promise((resolve) => window.setTimeout(resolve, 1800));
          }
          window.history.replaceState({}, "", window.location.pathname);
        }
      })
      .catch(() => { if (active) setSession("guest"); });
    return () => { active = false; };
  }, []);

  async function updateSubscription(action: "cancel" | "reactivate") {
    if (!currentSubscription || subscriptionBusy) return;
    setSubscriptionBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/subscriptions/${encodeURIComponent(currentSubscription.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No se pudo cancelar la suscripción.");
      if (action === "cancel") setCurrentSubscription(null);
      else setCurrentSubscription((subscription) => subscription ? { ...subscription, status: payload.status } : null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo actualizar la suscripción.");
    } finally {
      setSubscriptionBusy(false);
    }
  }

  return (
      <main className="app-shell pricing-shell" data-mp-subscriptions-page="without-plan-pending">
      <nav className="topbar" aria-label="Navegación principal">
        <BrandLogo />
        <Link className="pricing-nav-link" href="/buscar">{session === "member" ? "Ir a Leadta" : "Iniciar sesión"}</Link>
      </nav>

      <PricingHero variant="page" />

      <div className="pricing-workspace">
        {currentSubscription && (
          <section className="pricing-subscription" aria-label="Tu suscripción">
            <div>
              <strong>{subscriptionPlans.find((plan) => plan.id === currentSubscription.planId)?.name || "Tu plan"}</strong>
              <p>Estado: {currentSubscription.status === "authorized" ? "activa" : currentSubscription.status === "pending" || currentSubscription.status === "creating" ? "pendiente de autorización" : currentSubscription.status === "paused" ? "pausada" : currentSubscription.status === "cancelled" || currentSubscription.status === "canceled" ? "cancelada" : currentSubscription.status}</p>
            </div>
            {currentSubscription.status === "pending" && currentSubscription.checkoutUrl ? (
              <div className="pricing-subscription-actions">
                <button className="secondary-button" type="button" onClick={() => window.location.assign(currentSubscription.checkoutUrl)}>Continuar pago</button>
                <button className="secondary-button" type="button" disabled={subscriptionBusy} onClick={() => void updateSubscription("cancel")}>{subscriptionBusy ? "Cancelando…" : "Cancelar"}</button>
              </div>
            ) : currentSubscription.status === "authorized" || currentSubscription.status === "paused" ? (
              <div className="pricing-subscription-actions">
                {currentSubscription.status === "paused" && <button className="secondary-button" type="button" disabled={subscriptionBusy} onClick={() => void updateSubscription("reactivate")}>{subscriptionBusy ? "Actualizando…" : "Reactivar"}</button>}
                <button className="secondary-button" type="button" disabled={subscriptionBusy} onClick={() => void updateSubscription("cancel")}>{subscriptionBusy ? "Actualizando…" : "Cancelar suscripción"}</button>
              </div>
            ) : null}
          </section>
        )}

        {error && <p className="pricing-error" role="alert">{error}</p>}
      </div>
    </main>
  );
}
