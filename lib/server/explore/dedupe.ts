// Pure helpers to avoid paying twice for /explorar AI work: cross-user cache keys and the per-run step lease.
// No runtime imports with side effects: the selfcheck runs this file with plain node.
import { createHash } from "node:crypto";
import type { ExploreInput, ExploreProduct } from "@/lib/explore/types";

/** Cached research/competitors results live this long (days). */
export const EXPLORE_CACHE_TTL_DAYS = 7;
/** A step lease older than this is considered abandoned: a new request may take it over. */
export const LEASE_STALE_MS = 4 * 60_000;

/** Lowercase, NFKC, collapsed whitespace: "  Hola   Mundo " and "hola mundo" give the same key. */
export function normalizeText(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

const hash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 32);

/**
 * Research cache key. `domain` is the validated host of the web input ("" when not web or unreadable).
 * Web: the domain; text/services: a hash of the normalized visitor text. Always scoped by locale.
 */
export function researchCacheKey(input: ExploreInput, domain: string, locale: string) {
  if (input.mode === "web" && domain) return `web:${domain.toLowerCase()}:${locale}`;
  // Fields normalized one by one and JSON-joined: moving words between service fields gives another key.
  const fields = input.mode === "web" ? [input.url] : input.mode === "text" ? [input.description] : [input.offer, input.idealCustomer, input.markets];
  return `${input.mode}:${hash(JSON.stringify(fields.map(normalizeText)))}:${locale}`;
}

/** Competitors cache key: product domain (or hash of name + summary), the market the prompt uses, and locale. */
export function competitorsCacheKey(product: Pick<ExploreProduct, "name" | "domain" | "summary" | "location" | "country">, locale: string) {
  const id = product.domain ? `d:${product.domain.toLowerCase()}` : `h:${hash(`${normalizeText(product.name)}\n${normalizeText(product.summary)}`)}`;
  const market = normalizeText(product.location || product.country || "");
  return `${id}:${market ? hash(market).slice(0, 12) : "-"}:${locale}`;
}

/** PocketBase date ("YYYY-MM-DD HH:MM:SS.sssZ") or ISO → ms, or NaN. */
export function parseLeaseTime(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return NaN;
  return Date.parse(value.trim().replace(" ", "T"));
}

/** True when the run holds a live (not stale) lease for `step`. Missing fields (migration not applied) → false. */
export function hasLiveLease(record: { running_step?: unknown; running_since?: unknown }, step: string, now: number) {
  if (record.running_step !== step) return false;
  const since = parseLeaseTime(record.running_since);
  return Number.isFinite(since) && now - since < LEASE_STALE_MS;
}
