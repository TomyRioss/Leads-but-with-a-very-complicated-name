// Integration result flash: a short cookie instead of ?google=... query params, so N providers don't pile up in URLs.
// Pure and runtime-agnostic (server routes set it, the client reads and deletes it once).

export const INTEGRATION_FLASH_COOKIE = "leadta_integration_flash";
export const INTEGRATION_FLASH_MAX_AGE = 60;

export const INTEGRATION_FLASH_STATUSES = ["connected", "denied", "error", "not_configured"] as const;
export type IntegrationFlashStatus = (typeof INTEGRATION_FLASH_STATUSES)[number];

/** `provider` is an open slug (google, slack, hubspot…); `feature` is provider-specific (google: drive|gmail|calendar). */
export type IntegrationFlash = { provider: string; feature?: string; status: IntegrationFlashStatus };

const SLUG = /^[a-z][a-z0-9_-]{0,31}$/;

const toBase64url = (value: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(value))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const fromBase64url = (value: string) => {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
};

export function serializeIntegrationFlash(flash: IntegrationFlash): string {
  return toBase64url(JSON.stringify({ provider: flash.provider, status: flash.status, ...(flash.feature ? { feature: flash.feature } : {}) }));
}

/** Returns null for anything malformed or unknown (the cookie is client-writable, so it's untrusted). */
export function parseIntegrationFlash(value: string | null | undefined): IntegrationFlash | null {
  if (!value || value.length > 512) return null;
  try {
    const data = JSON.parse(fromBase64url(value)) as Partial<IntegrationFlash>;
    if (typeof data.provider !== "string" || !SLUG.test(data.provider)) return null;
    if (!INTEGRATION_FLASH_STATUSES.includes(data.status as IntegrationFlashStatus)) return null;
    if (data.feature !== undefined && (typeof data.feature !== "string" || !SLUG.test(data.feature))) return null;
    return { provider: data.provider, status: data.status as IntegrationFlashStatus, ...(data.feature ? { feature: data.feature } : {}) };
  } catch {
    return null;
  }
}
