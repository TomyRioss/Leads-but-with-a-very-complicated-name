import "server-only";
import { randomUUID } from "node:crypto";
import { PocketBaseRequestError, pocketBaseFetch } from "@/lib/server/pocketbase";

export type AccountMemoryFact = {
  key: "serviceOffering" | "commercialSectors" | "preferredTone" | "businessContext";
  value: string;
  sourceText: string;
  updatedAt: string;
};

const KEYS = new Set<AccountMemoryFact["key"]>(["serviceOffering", "commercialSectors", "preferredTone", "businessContext"]);
const MAX_FACTS = 20;
const MAX_VALUE = 300;
const MAX_SOURCE = 600;
const MAX_BYTES = 20_000;
const MAX_FACT_BYTES = 5_000;
const RECORDS = "/api/collections/leadtita_account_memory/records";
const LOCK_RECORDS = "/api/collections/leadtita_memory_locks/records";
const LOCK_TTL_MS = 120_000;
type MemoryRow = { id: string; user: string; key: string; fact: unknown };
type LockRow = { id: string; user: string; key: string; token: string; created?: string };
const clean = (value: string) => value.replace(/\s+/gu, " ").trim();
const normalized = (value: string) => clean(value).normalize("NFKC").toLowerCase();
const validUser = (value: string) => /^[a-zA-Z0-9]{15}$/.test(value);
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const fits = (facts: AccountMemoryFact[]) => Buffer.byteLength(JSON.stringify(facts), "utf8") <= MAX_BYTES;

// Screen the entire eligible message, not only the model's selected excerpt.
// False negatives are more harmful here than declining optional memory for a turn.
const CREDENTIAL_CONTEXT = /(?:\b(?:password|passphrase|credential|credentials|authorization|bearer|secret|token|clave)\b|contrase[ñn]a|credencial|api[_\s-]?key|private[_\s-]?key|access[_\s-]?key|client[_\s-]?secret|\bpin\s*[:=]|-----BEGIN)/iu;
const CREDENTIAL_FORMAT = /(?:\b(?:sk|pk|rk|sk_live|sk_test|pk_live|pk_test)[-_][a-z0-9_-]{16,}\b|\b(?:gh[pousr]_[a-z0-9]{20,}|github_pat_[a-z0-9_]{20,}|xox[baprs]-[a-z0-9-]{10,}|AKIA[A-Z0-9]{16}|ASIA[A-Z0-9]{16}|AIza[a-z0-9_-]{30,})\b|\beyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+\b|\b[a-f0-9]{64,}\b|[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@|-----BEGIN)/iu;
const sensitive = (value: string) => CREDENTIAL_CONTEXT.test(value.normalize("NFKC")) || CREDENTIAL_FORMAT.test(value.normalize("NFKC"));

function factFields(raw: unknown): Pick<AccountMemoryFact, "key" | "value" | "sourceText"> | null {
  if (!isObject(raw) || typeof raw.key !== "string" || !KEYS.has(raw.key as AccountMemoryFact["key"])) return null;
  if (typeof raw.value !== "string" || typeof raw.sourceText !== "string" || raw.value.length > 2_000 || raw.sourceText.length > MAX_SOURCE) return null;
  const value = clean(raw.value);
  const sourceText = raw.sourceText;
  if (!value || value.length > MAX_VALUE || !clean(sourceText) || sensitive(value) || sensitive(sourceText)) return null;
  // Conservative extractive grounding: no paraphrases or invented additions.
  if (!normalized(sourceText).includes(normalized(value))) return null;
  return { key: raw.key as AccountMemoryFact["key"], value, sourceText };
}

function storedFacts(rows: MemoryRow[], userId: string): AccountMemoryFact[] {
  if (rows.length > MAX_FACTS) return [];
  const byKey = new Map<AccountMemoryFact["key"], AccountMemoryFact>();
  for (const row of rows) {
    if (row.user !== userId) continue;
    const item = row.fact;
    const fields = factFields(item);
    if (!fields || fields.key !== row.key || !isObject(item) || typeof item.updatedAt !== "string" || item.updatedAt.length > 40 || !Number.isFinite(Date.parse(item.updatedAt))) continue;
    byKey.set(fields.key, { ...fields, updatedAt: new Date(item.updatedAt).toISOString() });
  }
  const facts = [...byKey.values()];
  return fits(facts) ? facts : [];
}

async function findMemory(userId: string, key?: AccountMemoryFact["key"]): Promise<MemoryRow[]> {
  const filter = `user = ${JSON.stringify(userId)}` + (key ? ` && key = ${JSON.stringify(key)}` : "");
  const query = new URLSearchParams({ filter, perPage: String(MAX_FACTS), skipTotal: "1", fields: "id,user,key,fact" });
  const result = await pocketBaseFetch<{ items: MemoryRow[] }>(`${RECORDS}?${query}`);
  return result.items.filter((row) => row.user === userId && (!key || row.key === key));
}

async function findLock(userId: string, key: AccountMemoryFact["key"]): Promise<LockRow | null> {
  const query = new URLSearchParams({
    filter: `user = ${JSON.stringify(userId)} && key = ${JSON.stringify(key)}`,
    perPage: "1", skipTotal: "1", fields: "id,user,key,token,created",
  });
  const result = await pocketBaseFetch<{ items: LockRow[] }>(`${LOCK_RECORDS}?${query}`);
  const row = result.items[0] ?? null;
  return row?.user === userId && row.key === key ? row : null;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function acquireLock(userId: string, key: AccountMemoryFact["key"]): Promise<LockRow> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const token = randomUUID();
    try {
      return await pocketBaseFetch<LockRow>(LOCK_RECORDS, {
        method: "POST", body: JSON.stringify({ user: userId, key, token }),
      });
    } catch (error) {
      if (!(error instanceof PocketBaseRequestError) || error.status !== 400) throw error;
      const existing = await findLock(userId, key);
      if (!existing) throw error;
      const createdAt = Date.parse(existing.created ?? "");
      if (!Number.isFinite(createdAt) || Date.now() - createdAt > LOCK_TTL_MS) {
        await pocketBaseFetch(`${LOCK_RECORDS}/${encodeURIComponent(existing.id)}`, { method: "DELETE" }).catch(() => undefined);
        continue;
      }
      await wait(100);
    }
  }
  throw new Error("Memory update lock timed out.");
}

async function releaseLock(userId: string, key: AccountMemoryFact["key"], token: string) {
  const existing = await findLock(userId, key).catch(() => null);
  if (existing?.token === token) await pocketBaseFetch(`${LOCK_RECORDS}/${encodeURIComponent(existing.id)}`, { method: "DELETE" }).catch(() => undefined);
}

/** The caller must pass the session's authenticated user ID, never a tool argument. */
export async function getAccountMemory(userId: string): Promise<AccountMemoryFact[]> {
  if (!validUser(userId)) return [];
  try {
    return storedFacts(await findMemory(userId), userId);
  } catch {
    // PocketBase errors may contain submitted facts. Never log them.
    return [];
  }
}

async function upsertFact(userId: string, fact: AccountMemoryFact): Promise<void> {
  const lock = await acquireLock(userId, fact.key);
  try {
    // Compare while holding the database-backed lock so an older delayed request cannot replace a newer fact.
    const existing = (await findMemory(userId, fact.key))[0];
    const stored = existing ? storedFacts([existing], userId)[0] : undefined;
    if (stored && Date.parse(stored.updatedAt) >= Date.parse(fact.updatedAt)) return;
    await pocketBaseFetch(existing ? `${RECORDS}/${encodeURIComponent(existing.id)}` : RECORDS, {
      method: existing ? "PATCH" : "POST",
      body: JSON.stringify({ user: userId, key: fact.key, fact }),
    });
  } finally {
    await releaseLock(userId, fact.key, lock.token);
  }
}

/** Only latestUserText is evidence. Callers must supply the latest user-authored plain text. */
export async function rememberAccountFacts(userId: string, candidates: unknown, latestUserText: string): Promise<AccountMemoryFact[]> {
  if (!validUser(userId) || !Array.isArray(candidates) || candidates.length > MAX_FACTS || typeof latestUserText !== "string") return [];
  // Defense in depth for the attachment serialization used by chat; an unclosed block excludes its remainder.
  const userText = latestUserText.replace(/<attachment\b[^>]*>[\s\S]*?(?:<\/attachment\s*>|$)/gi, "");
  if (sensitive(userText)) return [];
  const updates = new Map<AccountMemoryFact["key"], AccountMemoryFact>();
  const updatedAt = new Date().toISOString();
  for (const candidate of candidates) {
    const fact = factFields(candidate);
    if (!fact || !latestUserText.includes(fact.sourceText) || !userText.includes(fact.sourceText)) continue;
    const update = { ...fact, updatedAt };
    if (Buffer.byteLength(JSON.stringify(update), "utf8") > MAX_FACT_BYTES) continue;
    updates.set(fact.key, update);
  }
  if (!updates.size) return [];

  try {
    // At most four independent writes. A row never contains another key's value,
    // so instances cannot overwrite unrelated facts by replacing stale arrays.
    const results = await Promise.allSettled([...updates.values()].map((fact) => upsertFact(userId, fact)));
    if (results.some((result) => result.status === "rejected")) return [];
    return await getAccountMemory(userId);
  } catch {
    return [];
  }
}
