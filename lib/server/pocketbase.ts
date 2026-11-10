const pocketBaseUrl = process.env.POCKETBASE_URL?.replace(/\/$/, "");
const superuserEmail = process.env.POCKETBASE_SUPERUSER_EMAIL;
const superuserPassword = process.env.POCKETBASE_SUPERUSER_PASSWORD;
const bridgeSecret = process.env.POCKETBASE_BRIDGE_SECRET;
const bridgeRequired = Boolean(pocketBaseUrl && new URL(pocketBaseUrl).pathname !== "/");

function bridgeHeaders(): Record<string, string> {
  return bridgeSecret ? { "X-Leadta-Bridge-Key": bridgeSecret } : {};
}

export class PocketBaseRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "PocketBaseRequestError";
  }
}

export function isPocketBaseConfigured() {
  return Boolean(pocketBaseUrl && superuserEmail && superuserPassword && (!bridgeRequired || bridgeSecret));
}

export async function pocketBasePublicFetch<T>(path: string, init: RequestInit = {}) {
  if (!pocketBaseUrl) throw new Error("Falta configurar POCKETBASE_URL.");

  const response = await fetch(`${pocketBaseUrl}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...bridgeHeaders(), ...init.headers },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new PocketBaseRequestError("PocketBase rechazó la solicitud.", response.status);
  }
  return (await response.json()) as T;
}

async function authenticate() {
  if (!pocketBaseUrl || !superuserEmail || !superuserPassword) {
    throw new Error("Falta configurar la conexión con PocketBase.");
  }

  const response = await fetch(
    `${pocketBaseUrl}/api/collections/_superusers/auth-with-password`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...bridgeHeaders() },
      body: JSON.stringify({ identity: superuserEmail, password: superuserPassword }),
      cache: "no-store",
    },
  );

  if (!response.ok) throw new Error("No se pudo autenticar con PocketBase.");
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
    throw new Error(`PocketBase respondió ${response.status}: ${detail.slice(0, 240)}`);
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
