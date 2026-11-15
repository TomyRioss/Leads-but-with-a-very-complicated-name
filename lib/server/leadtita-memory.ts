import "server-only";
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
const RECORDS = "/api/collections/leadtita_account_memory/records";
type MemoryRow = { id: string; user: string; facts: unknown };
const clean = (value: string) => value.replace(/\s+/gu, " ").trim();
const normalized = (value: string) => clean(value).normalize("NFKC").toLowerCase();
const validUser = (value: string) => /^[a-zA-Z0-9]{15}$/.test(value);
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const fits = (facts: AccountMemoryFact[]) => Buffer.byteLength(JSON.stringify(facts), "utf8") <= MAX_BYTES;

function factFields(raw: unknown): Pick<AccountMemoryFact, "key" | "value" | "sourceText"> | null {
  if (!isObject(raw) || typeof raw.key !== "string" || !KEYS.has(raw.key as AccountMemoryFact["key"])) return null;
  if (typeof raw.value !== "string" || typeof raw.sourceText !== "string" || raw.value.length > 2_000 || raw.sourceText.length > MAX_SOURCE) return null;
  const value = clean(raw.value);
  const sourceText = raw.sourceText;
  if (!value || value.length > MAX_VALUE || !clean(sourceText)) return null;
  // Conservative extractive grounding: no paraphrases or invented additions.
  if (!normalized(sourceText).includes(normalized(value))) return null;
  return { key: raw.key as AccountMemoryFact["key"], value, sourceText };
}

function storedFacts(raw: unknown): AccountMemoryFact[] {
  if (!Array.isArray(raw) || raw.length > MAX_FACTS) return [];
  const byKey = new Map<AccountMemoryFact["key"], AccountMemoryFact>();
  for (const item of raw) {
    const fields = factFields(item);
    if (!fields || !isObject(item) || typeof item.updatedAt !== "string" || item.updatedAt.length > 40 || !Number.isFinite(Date.parse(item.updatedAt))) continue;
    byKey.set(fields.key, { ...fields, updatedAt: new Date(item.updatedAt).toISOString() });
  }
  const facts = [...byKey.values()];
  return fits(facts) ? facts : [];
}

async function findMemory(userId: string): Promise<MemoryRow | null> {
  const query = new URLSearchParams({ filter: `user = ${JSON.stringify(userId)}`, perPage: "1", skipTotal: "1", fields: "id,user,facts" });
  const result = await pocketBaseFetch<{ items: MemoryRow[] }>(`${RECORDS}?${query}`);
  const row = result.items[0];
  return row?.user === userId ? row : null;
}

/** The caller must pass the session's authenticated user ID, never a tool argument. */
export async function getAccountMemory(userId: string): Promise<AccountMemoryFact[]> {
  if (!validUser(userId)) return [];
  try {
    const row = await findMemory(userId);
    return row ? storedFacts(row.facts) : [];
  } catch {
    // PocketBase errors may contain submitted facts. Never log them.
    return [];
  }
}

// Serialize updates per account within this process, without caching private facts.
const pendingUpdates = new Map<string, Promise<AccountMemoryFact[]>>();

/** Only latestUserText is evidence. Callers must supply the latest user-authored plain text. */
export async function rememberAccountFacts(userId: string, candidates: unknown, latestUserText: string): Promise<AccountMemoryFact[]> {
  if (!validUser(userId) || !Array.isArray(candidates) || candidates.length > MAX_FACTS || typeof latestUserText !== "string") return [];
  // Defense in depth for the attachment serialization used by chat; an unclosed block excludes its remainder.
  const userText = latestUserText.replace(/<attachment\b[^>]*>[\s\S]*?(?:<\/attachment\s*>|$)/gi, "");
  const updates = new Map<AccountMemoryFact["key"], AccountMemoryFact>();
  const updatedAt = new Date().toISOString();
  for (const candidate of candidates) {
    const fact = factFields(candidate);
    if (!fact || !latestUserText.includes(fact.sourceText) || !userText.includes(fact.sourceText)) continue;
    // Do not persist credential-like content even if explicitly supplied.
    if (/(?:password|contrase[ñn]a|api[_ -]?key|access[_ -]?token|secret|bearer\s|-----BEGIN)/iu.test(fact.sourceText)) continue;
    updates.set(fact.key, { ...fact, updatedAt });
  }
  if (!updates.size) return [];

  const previous = pendingUpdates.get(userId);
  const operation = (async () => {
    if (previous) await previous;
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const existing = await findMemory(userId);
        const merged = new Map(storedFacts(existing?.facts).map((fact) => [fact.key, fact]));
        for (const fact of updates.values()) merged.set(fact.key, fact);
        const facts = [...merged.values()];
        if (facts.length > MAX_FACTS || !fits(facts)) return [];
        try {
          await pocketBaseFetch(existing ? `${RECORDS}/${encodeURIComponent(existing.id)}` : RECORDS, {
            method: existing ? "PATCH" : "POST",
            body: JSON.stringify({ user: userId, facts }),
          });
          return facts;
        } catch (error) {
          // Retry a concurrent first insert against the unique user index.
          if (existing || attempt || !(error instanceof PocketBaseRequestError) || error.status !== 400) return [];
        }
      }
    } catch {
      // Optional memory must never block chat or expose persistence details.
    }
    return [];
  })();
  pendingUpdates.set(userId, operation);
  try {
    return await operation;
  } finally {
    if (pendingUpdates.get(userId) === operation) pendingUpdates.delete(userId);
  }
}
