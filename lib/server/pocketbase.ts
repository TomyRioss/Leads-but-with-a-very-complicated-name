const pocketBaseUrl = process.env.POCKETBASE_URL?.replace(/\/$/, "");
const superuserEmail = process.env.POCKETBASE_SUPERUSER_EMAIL;
const superuserPassword = process.env.POCKETBASE_SUPERUSER_PASSWORD;
const bridgeSecret = process.env.POCKETBASE_BRIDGE_SECRET;
const bridgeRequired = Boolean(pocketBaseUrl && new URL(pocketBaseUrl).pathname !== "/");

function bridgeHeaders(): Record<string, string> {
  return bridgeSecret ? { "X-Leadta-Bridge-Key": bridgeSecret } : {};
}

export class PocketBaseRequestError extends Error {
  constructor(message: string, readonly status: number, readonly detail = "", readonly operation = "") {
    super(message);
    this.name = "PocketBaseRequestError";
  }
}

export function isPocketBaseConfigured() {
  return Boolean(pocketBaseUrl && superuserEmail && superuserPassword && (!bridgeRequired || bridgeSecret));
}

export async function pocketBasePublicFetch<T>(path: string, init: RequestInit = {}) {
  if (!pocketBaseUrl) throw new Error("POCKETBASE_URL is not configured.");

  const response = await fetch(`${pocketBaseUrl}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...bridgeHeaders(), ...init.headers },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new PocketBaseRequestError("PocketBase rejected the request.", response.status);
  }
  return (await response.json()) as T;
}

export type PocketBaseAuthFailure = "missing_env" | "login_failed" | "unreachable";

/** Fallo al obtener el token de superuser; `reason` distingue falta de env, login rechazado y PocketBase caído. */
export class PocketBaseAuthError extends Error {
  constructor(message: string, readonly reason: PocketBaseAuthFailure) {
    super(message);
    this.name = "PocketBaseAuthError";
  }
}

async function authenticate() {
  const missing = [
    !pocketBaseUrl && "POCKETBASE_URL",
    !superuserEmail && "POCKETBASE_SUPERUSER_EMAIL",
    !superuserPassword && "POCKETBASE_SUPERUSER_PASSWORD",
    bridgeRequired && !bridgeSecret && "POCKETBASE_BRIDGE_SECRET",
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new PocketBaseAuthError(`Missing PocketBase environment variables: ${missing.join(", ")}.`, "missing_env");
  }

  let response: Response;
  try {
    response = await fetch(
      `${pocketBaseUrl}/api/collections/_superusers/auth-with-password`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...bridgeHeaders() },
        body: JSON.stringify({ identity: superuserEmail, password: superuserPassword }),
        cache: "no-store",
      },
    );
  } catch (error) {
    throw new PocketBaseAuthError(`Couldn't reach PocketBase: ${error instanceof Error ? error.message : "unknown error"}.`, "unreachable");
  }

  if (!response.ok) {
    throw new PocketBaseAuthError(
      `The PocketBase superuser login was rejected (${response.status}).`,
      response.status >= 500 ? "unreachable" : "login_failed",
    );
  }
  const payload = (await response.json()) as { token: string };
  return payload.token;
}

export async function pocketBaseFetch<T>(path: string, init: RequestInit = {}) {
  const token = await authenticate();
  const response = await fetch(`${pocketBaseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
      ...bridgeHeaders(),
      ...init.headers,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await response.text();
    // Method + path without the query string (filters carry user ids) so logs name the failing collection/operation.
    const operation = `${init.method || "GET"} ${path.split("?")[0]}`;
    throw new PocketBaseRequestError(`PocketBase responded ${response.status} to ${operation}: ${detail.slice(0, 240)}`, response.status, detail, operation);
  }

  if (response.status === 204) return null as T;
  return (await response.json()) as T;
}

export async function createLeadRecords(batchId: string, records: Record<string, unknown>[]) {
  if (records.length === 0) return { created: 0, failed: 0 };

  const token = await authenticate();
  const maxConcurrency = 10;
  let nextIndex = 0;
  let created = 0;
  let failed = 0;

  await Promise.all(Array.from({ length: Math.min(maxConcurrency, records.length) }, async () => {
    while (nextIndex < records.length) {
      const index = nextIndex++;
      try {
        const response = await fetch(`${pocketBaseUrl}/api/collections/leads/records`, {
          method: "POST",
          headers: { Authorization: token, "Content-Type": "application/json", ...bridgeHeaders() },
          body: JSON.stringify({ ...records[index], batch: batchId }),
          cache: "no-store",
        });
        if (!response.ok) throw new Error(`PocketBase rejected a lead with status ${response.status}.`);
        created++;
      } catch {
        failed++;
      }
    }
  }));

  return { created, failed };
}
