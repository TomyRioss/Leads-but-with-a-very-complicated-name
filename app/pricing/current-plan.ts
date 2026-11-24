"use client";

import { useEffect, useState } from "react";

// Current plan: the last known value paints instantly (sessionStorage), then one lookup shared by every consumer on the
// page refreshes it. A purchase or cancel resets both so nothing shows stale state. ponytail: not keyed by user; the refresh corrects it within one request.
const PLAN_CACHE = "leadta-current-plan";
let request: Promise<string | null> | null = null;
const listeners = new Set<() => void>();

function cachedPlan(): string | null {
  try { return sessionStorage.getItem(PLAN_CACHE) || null; } catch { return null; }
}

function load() {
  request ??= fetch("/api/subscriptions", { cache: "no-store" })
    .then((response) => (response.ok || response.status === 401 ? response.json().catch(() => null) : undefined))
    .then((payload: { subscription?: { planId?: string } | null } | null | undefined) => {
      if (payload === undefined) return cachedPlan(); // server error: keep what we knew
      const planId = payload?.subscription?.planId ?? null;
      try { sessionStorage.setItem(PLAN_CACHE, planId ?? ""); } catch { /* private mode: no cache */ }
      return planId;
    })
    .catch(() => cachedPlan())
    .finally(() => { request = null; }); // concurrent consumers share it; the next visit asks again
  return request;
}

/** Forget the stored plan and make every mounted consumer ask again. */
export function resetCurrentPlan() {
  request = null;
  try { sessionStorage.removeItem(PLAN_CACHE); } catch { /* private mode: no cache */ }
  listeners.forEach((refresh) => refresh());
}

/** Leadta plan id of the user's live subscription, null without one (or while unknown). */
export function useCurrentPlan() {
  const [planId, setPlanId] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const refresh = () => { load().then((id) => { if (active) setPlanId(id); }); };
    setPlanId(cachedPlan());
    refresh();
    listeners.add(refresh);
    return () => { active = false; listeners.delete(refresh); };
  }, []);
  return planId;
}
