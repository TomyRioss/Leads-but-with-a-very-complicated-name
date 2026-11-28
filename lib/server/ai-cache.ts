import "server-only";
import { createHash } from "node:crypto";
import { isPocketBaseConfigured, PocketBaseRequestError, pocketBaseFetch } from "@/lib/server/pocketbase";

// Server-only cache of expensive AI results (`ai_cache` collection, all rules null). One row per (kind, key_hash).
export type AiCacheKind = "research" | "competitors" | "leads" | "enrichment" | "pain";

type CacheRow = { id: string; payload?: unknown; expires_at?: string };
type CacheList = { items?: CacheRow[] };

const COLLECTION = "/api/collections/ai_cache/records";
const REQUEST_TIMEOUT_MS = 3_000;
const MAX_TTL_DAYS = 365;
const DAY_MS = 86_400_000;

const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

/** PocketBase stores dates as "YYYY-MM-DD HH:MM:SS.sssZ"; Date.parse needs the "T". */
function parseDate(value: unknown) {
  if (typeof value !== "string" || !value) return NaN;
  return Date.parse(value.replace(" ", "T"));
}

async function findRow(kind: AiCacheKind, keyHash: string, fields: string) {
  const params = new URLSearchParams({
    filter: `kind = ${JSON.stringify(kind)} && key_hash = ${JSON.stringify(keyHash)}`,
    fields,
    perPage: "1",
    skipTotal: "1",
  });
  const result = await pocketBaseFetch<CacheList>(`${COLLECTION}?${params}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  return result?.items?.[0] ?? null;
}

function deleteRow(id: string) {
  pocketBaseFetch(`${COLLECTION}/${encodeURIComponent(id)}`, { method: "DELETE", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    .catch(() => undefined);
}

/** Cached value or null (missing, expired, malformed, or any PocketBase error). Never throws. */
export async function readAiCache<T>(kind: AiCacheKind, key: string): Promise<T | null> {
  try {
    if (!isPocketBaseConfigured()) return null;
    const row = await findRow(kind, hashKey(key), "id,payload,expires_at");
    if (!row) return null;
    const expiresAt = parseDate(row.expires_at);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      deleteRow(row.id);
      return null;
    }
    return row.payload === undefined || row.payload === null ? null : row.payload as T;
  } catch (error) {
    console.error("ai_cache read failed", error instanceof Error ? error.name : "unknown");
    return null;
  }
}

/** Upsert with TTL in days. Best effort: never throws, logs on failure. */
export async function writeAiCache(kind: AiCacheKind, key: string, value: unknown, ttlDays: number): Promise<void> {
  try {
    if (!isPocketBaseConfigured() || value === undefined) return;
    if (!Number.isFinite(ttlDays) || ttlDays <= 0) return;
    const keyHash = hashKey(key);
    const body = JSON.stringify({
      kind,
      key_hash: keyHash,
      payload: value,
      expires_at: new Date(Date.now() + Math.min(ttlDays, MAX_TTL_DAYS) * DAY_MS).toISOString(),
    });
    const patch = (id: string) => pocketBaseFetch(`${COLLECTION}/${encodeURIComponent(id)}`, {
      method: "PATCH", body, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const existing = await findRow(kind, keyHash, "id");
    if (existing) {
      await patch(existing.id);
      return;
    }
    try {
      await pocketBaseFetch(COLLECTION, { method: "POST", body, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (error) {
      // A concurrent writer created the unique (kind, key_hash) row first: theirs is an equivalent result.
      if (error instanceof PocketBaseRequestError && error.status === 400 && (await findRow(kind, keyHash, "id"))) return;
      throw error;
    }
  } catch (error) {
    console.error("ai_cache write failed", error instanceof Error ? error.name : "unknown");
  }
}
