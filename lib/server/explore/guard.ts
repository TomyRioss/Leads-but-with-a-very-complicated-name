import "server-only";
import { EXPLORE_RUNS_PER_IP_PER_DAY, type ExploreInput } from "@/lib/explore/types";
import { clientIp, rateLimited } from "@/lib/server/rate-limit";
import { verifyTurnstile } from "@/lib/server/turnstile";
import { countRunsByIp, hashIp } from "@/lib/server/explore/store";
import { hostOf } from "@/lib/server/explore/ai";

const DESCRIPTION_MAX = 1000;
const SERVICE_FIELD_MAX = 300;
const URL_MAX = 300;
const DAY_MS = 24 * 60 * 60_000;
// In-memory, per instance: cheap first line before Turnstile/PocketBase; the daily quota is DB-backed.
const START_RATE = { max: 6, windowMs: 10 * 60_000 } as const;
const STEP_RATE = { max: 30, windowMs: 10 * 60_000 } as const;
// Each step-1 edit regenerates steps 2-5 (AI + Apify).
const EDIT_RATE = { max: 3, windowMs: 10 * 60_000 } as const;

const text = (value: unknown, max: number) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : null;
};

/** "loruppa.com" → "https://loruppa.com". Only public http(s) domains (no IPs, localhost, credentials or ports). */
export function normalizePublicUrl(value: unknown): string | null {
  const raw = text(value, URL_MAX);
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostOf(host) || /\.(local|localhost|internal|lan|home|test|example|invalid)$/.test(host)) return null;
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
  return `${url.protocol}//${host}${path}`;
}

/** Validated, bounded visitor input, or null. */
export function parseExploreInput(value: unknown): ExploreInput | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.mode === "text") {
    const description = text(raw.description, DESCRIPTION_MAX);
    return description ? { mode: "text", description } : null;
  }
  if (raw.mode === "web") {
    const url = normalizePublicUrl(raw.url);
    return url ? { mode: "web", url } : null;
  }
  if (raw.mode === "services") {
    const offer = text(raw.offer, SERVICE_FIELD_MAX);
    const idealCustomer = text(raw.idealCustomer, SERVICE_FIELD_MAX);
    const markets = text(raw.markets, SERVICE_FIELD_MAX);
    return offer && idealCustomer && markets ? { mode: "services", offer, idealCustomer, markets } : null;
  }
  return null;
}

export type StartGuard = { ok: true; ipHash: string } | { ok: false; status: number; error: "rate_limited" | "captcha" | "quota" };

/** Start of a run: in-memory burst limit, Turnstile, then the DB-backed daily quota per IP. */
export async function guardStart(request: Request, turnstileToken: unknown): Promise<StartGuard> {
  const ip = clientIp(request);
  if (rateLimited(`explore-start:${ip}`, START_RATE.max, START_RATE.windowMs)) return { ok: false, status: 429, error: "rate_limited" };
  const captcha = await verifyTurnstile(turnstileToken, ip);
  if (!captcha.ok) return { ok: false, status: 400, error: "captcha" };
  const ipHash = hashIp(ip);
  const used = await countRunsByIp(ipHash, new Date(Date.now() - DAY_MS).toISOString());
  if (used >= EXPLORE_RUNS_PER_IP_PER_DAY) return { ok: false, status: 429, error: "quota" };
  return { ok: true, ipHash };
}

/** True when this IP made too many step calls recently (per instance). */
export function stepRateLimited(request: Request) {
  return rateLimited(`explore-step:${clientIp(request)}`, STEP_RATE.max, STEP_RATE.windowMs);
}

export function editRateLimited(request: Request) {
  return rateLimited(`explore-edit:${clientIp(request)}`, EDIT_RATE.max, EDIT_RATE.windowMs);
}

const inFlight = new Map<string, Promise<unknown>>();

/** Runs `task` once per key on this instance: a duplicate call while it runs awaits the same result (no double Apify/AI spend). */
export function once<T>(key: string, task: () => Promise<T>): Promise<T> {
  const running = inFlight.get(key);
  if (running) return running as Promise<T>;
  const promise = task().finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}
