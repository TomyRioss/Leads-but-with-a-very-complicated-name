// Cloudflare Turnstile verification for signup/login. Cloudflare rejects a token used twice, so replays fail there.
// Keys: TURNSTILE_SECRET_KEY (server) + NEXT_PUBLIC_TURNSTILE_SITE_KEY (widget). Outside production, Cloudflare's
// official "always passes" test keys apply when none are set, so local signup/login keep working.

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TEST_SECRET = "1x0000000000000000000000000000000AA";
const TIMEOUT_MS = 5_000;

function secretKey() {
  // trim: a newline/space pasted with the value in the hosting dashboard makes Cloudflare reject the secret.
  return process.env.TURNSTILE_SECRET_KEY?.trim() || (process.env.NODE_ENV === "production" ? "" : TEST_SECRET);
}

/**
 * Cloudflare's verdict on `token`. Fails closed: missing key, network error or timeout → ok: false.
 * `reason` is safe to log and return (Cloudflare error-codes such as "invalid-input-secret", never the secret or token).
 */
export async function verifyTurnstile(token: unknown, remoteIp?: string): Promise<{ ok: boolean; reason: string }> {
  if (typeof token !== "string" || !token || token.length > 2_048) return { ok: false, reason: "missing-token" };
  const secret = secretKey();
  if (!secret) {
    console.error("Turnstile: TURNSTILE_SECRET_KEY is not configured; rejecting signup/login.");
    return { ok: false, reason: "not-configured" };
  }
  const form = new URLSearchParams({ secret, response: token });
  if (remoteIp && remoteIp !== "unknown") form.set("remoteip", remoteIp);
  try {
    const response = await fetch(VERIFY_URL, { method: "POST", body: form, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    if (!response.ok) return { ok: false, reason: `http-${response.status}` };
    const result = await response.json() as { success?: boolean; "error-codes"?: unknown; hostname?: unknown };
    if (result.success === true) return { ok: true, reason: "" };
    const codes = Array.isArray(result["error-codes"]) ? result["error-codes"].filter((code): code is string => typeof code === "string").join(",") : "";
    console.warn("Turnstile rejected token:", codes || "no-error-codes", "hostname:", typeof result.hostname === "string" ? result.hostname : "-");
    return { ok: false, reason: codes || "rejected" };
  } catch (error) {
    console.error("Turnstile verification failed", error instanceof Error ? error.name : "unknown");
    return { ok: false, reason: "network" };
  }
}
