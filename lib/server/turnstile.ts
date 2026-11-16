// Cloudflare Turnstile verification for signup/login. Cloudflare rejects a token used twice, so replays fail there.
// Keys: TURNSTILE_SECRET_KEY (server) + NEXT_PUBLIC_TURNSTILE_SITE_KEY (widget). Outside production, Cloudflare's
// official "always passes" test keys apply when none are set, so local signup/login keep working.

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TEST_SECRET = "1x0000000000000000000000000000000AA";
const TIMEOUT_MS = 5_000;

function secretKey() {
  return process.env.TURNSTILE_SECRET_KEY || (process.env.NODE_ENV === "production" ? "" : TEST_SECRET);
}

/** True when Cloudflare confirms `token`. Fails closed: missing key, network error or timeout → false. */
export async function verifyTurnstile(token: unknown, remoteIp?: string) {
  if (typeof token !== "string" || !token || token.length > 2_048) return false;
  const secret = secretKey();
  if (!secret) {
    console.error("Turnstile: TURNSTILE_SECRET_KEY is not configured; rejecting signup/login.");
    return false;
  }
  const form = new URLSearchParams({ secret, response: token });
  if (remoteIp && remoteIp !== "unknown") form.set("remoteip", remoteIp);
  try {
    const response = await fetch(VERIFY_URL, { method: "POST", body: form, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    if (!response.ok) return false;
    const result = await response.json() as { success?: boolean };
    return result.success === true;
  } catch (error) {
    console.error("Turnstile verification failed", error instanceof Error ? error.name : "unknown");
    return false;
  }
}
