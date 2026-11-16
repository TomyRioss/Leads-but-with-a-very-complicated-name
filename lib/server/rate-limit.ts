// Sliding-window limiter shared by API routes.
// ponytail: per-instance memory, so each serverless instance counts on its own; move to a shared store
// (Vercel Firewall rate-limit rules or Redis) if abuse spreads across instances.
const buckets = new Map<string, number[]>();
const MAX_KEYS = 10_000;

/** Records one hit for `key` and returns true when it exceeds `max` hits within `windowMs`. */
export function rateLimited(key: string, max: number, windowMs: number, hits = 1) {
  const now = Date.now();
  const recent = (buckets.get(key) ?? []).filter((at) => now - at < windowMs);
  if (recent.length + hits > max) {
    buckets.set(key, recent);
    return true;
  }
  buckets.delete(key); // re-insert at the end: Map order doubles as LRU for eviction
  buckets.set(key, [...recent, ...Array<number>(hits).fill(now)]);
  if (buckets.size > MAX_KEYS) buckets.delete(buckets.keys().next().value!);
  return false;
}

/** Client IP behind Vercel's proxy (x-forwarded-for first hop), or "unknown". */
export function clientIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || "unknown";
}

/** AI endpoints: 10 requests per minute per user. */
export const AI_RATE = { max: 10, windowMs: 60_000 } as const;
