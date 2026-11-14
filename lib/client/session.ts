"use client";

import { syncHistoryOwner } from "@/lib/client/leadtita-history";

export type SessionUser = { id: string; email: string; credits: number; role?: string; [key: string]: unknown };
export type SessionResult = { ok: boolean; user: SessionUser | null; error?: string };

// ponytail: per-tab in-memory cache. 15 s TTL bounds staleness (credits changed in another tab, login in another tab).
const ttlMs = 15_000;
let entry: { at: number; value: Promise<SessionResult>; resolved?: SessionResult } | null = null;

async function fetchSession(): Promise<SessionResult> {
  const response = await fetch("/api/auth/me", { cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  const user: SessionUser | null = payload.user ?? null;
  // Only a definitive answer (signed in, or signed out) moves Leadtita's local history; server errors leave it alone.
  if (response.ok || response.status === 401) syncHistoryOwner(user ? String(user.id) : null);
  return { ok: response.ok, user, error: payload.error };
}

/** Single shared /api/auth/me per tab: concurrent callers share one request; result reused for 15 s. */
export function getSession(): Promise<SessionResult> {
  if (!entry || Date.now() - entry.at > ttlMs) {
    const value = fetchSession();
    entry = { at: Date.now(), value };
    // Errors and signed-out results are never reused.
    value.then((result) => {
      if (!result.ok || !result.user) dropIfCurrent(value);
      else if (entry?.value === value) entry.resolved = result;
    }, () => dropIfCurrent(value));
  }
  return entry.value;
}

function dropIfCurrent(value: Promise<SessionResult>) {
  if (entry?.value === value) entry = null;
}

/** Signed-in user already resolved and fresh in this tab, for an instant first render; null otherwise. */
export function peekSessionUser(): SessionUser | null {
  if (!entry?.resolved || Date.now() - entry.at > ttlMs) return null;
  return entry.resolved.user;
}

/** Call on login, logout, or any account change. */
export function invalidateSession() {
  entry = null;
}

/** Keep the cached session in step after a server response reports new credits. */
export function setSessionCredits(credits: number) {
  if (!entry) return;
  const previous = entry.value;
  const resolved = entry.resolved?.user ? { ...entry.resolved, user: { ...entry.resolved.user, credits } } : entry.resolved;
  entry = { at: entry.at, resolved, value: previous.then((result) => result.user ? { ...result, user: { ...result.user, credits } } : result) };
}
