import { hostOf } from "@/lib/server/explore/ai";
import { clientIp, rateLimited } from "@/lib/server/rate-limit";

// GET /api/favicon?domain=<host>: favicon de Google (gstatic) o 404 si Google no lo tiene.
// gstatic responde 404 CON un globo genérico y sin CORS, así que el navegador no puede distinguirlo: acá sí.
// Solo pide a gstatic (nunca al dominio): sin riesgo de SSRF.
const RATE = { max: 120, windowMs: 60_000 } as const;
const TIMEOUT_MS = 4000;
const MAX_BYTES = 64 * 1024;
const FOUND = "public, max-age=604800, s-maxage=604800, immutable";
const MISSING = "public, max-age=86400, s-maxage=86400";

const missing = (status = 404) => new Response(null, { status, headers: { "Cache-Control": status === 404 ? MISSING : "no-store" } });

export async function GET(request: Request) {
  const domain = hostOf(new URL(request.url).searchParams.get("domain"));
  if (!domain) return missing(400);
  if (rateLimited(`favicon:${clientIp(request)}`, RATE.max, RATE.windowMs)) return missing(429);
  try {
    const upstream = await fetch(
      `https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&url=${encodeURIComponent(`https://${domain}`)}&size=32`,
      { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" },
    );
    const type = upstream.headers.get("content-type") ?? "";
    if (!upstream.ok || !type.startsWith("image/")) return missing();
    const body = await upstream.arrayBuffer();
    if (body.byteLength === 0 || body.byteLength > MAX_BYTES) return missing();
    return new Response(body, { headers: { "Content-Type": type, "Cache-Control": FOUND, "X-Content-Type-Options": "nosniff" } });
  } catch {
    return missing(504);
  }
}
