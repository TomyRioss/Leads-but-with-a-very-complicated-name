// Google OAuth connections: tokens are AES-256-GCM encrypted at rest and never leave the server (no logging, no client fields).
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { pocketBaseFetch } from "@/lib/server/pocketbase";

export const GOOGLE_MAX_FILES = 50;
const TOKEN_TIMEOUT_MS = 10_000;
/** Refresh a bit before Google's expiry so a token never dies mid-request. */
const EXPIRY_MARGIN_MS = 60_000;
const COLLECTION = "google_connections";

export type GoogleFile = { id: string; name: string; mimeType: string; url: string; addedAt: string };

/** Public view of a connection: no tokens. */
export type GoogleConnection = { id: string; userId: string; googleEmail: string; googleSub: string; /** Space-separated. */ scopes: string; files: GoogleFile[]; accessExpiresAt: string | null };

export type SaveConnectionData = {
  googleEmail: string;
  googleSub: string;
  /** Space-separated granted scopes. */
  scopes: string;
  /** Plain-text tokens: encrypted here, never stored or returned in clear. */
  accessToken: string;
  /** ISO instant when the access token expires. */
  accessExpiresAt: string;
  /** Google only returns it on consent; when absent the stored one is kept. */
  refreshToken?: string;
};

export class GoogleNotConnectedError extends Error {
  constructor() {
    super("Google Drive is not connected.");
    this.name = "GoogleNotConnectedError";
  }
}

export class GoogleFilesLimitError extends Error {
  constructor() {
    super(`At most ${GOOGLE_MAX_FILES} Google files can be connected.`);
    this.name = "GoogleFilesLimitError";
  }
}

type ConnectionRow = {
  id: string; user: string; google_email?: string; google_sub?: string; scopes?: string;
  refresh_token_enc?: string; access_token_enc?: string; access_expires_at?: string; files?: unknown;
};

export const isGoogleDriveFullAccess = () => process.env.GOOGLE_DRIVE_FULL_ACCESS === "true";

export const GOOGLE_SCOPES = {
  driveFile: "https://www.googleapis.com/auth/drive.file",
  gmailSend: "https://www.googleapis.com/auth/gmail.send",
  calendarEvents: "https://www.googleapis.com/auth/calendar.events",
} as const;
export const GOOGLE_FEATURES = ["gmail", "calendar"] as const;
export type GoogleFeature = (typeof GOOGLE_FEATURES)[number];
const FEATURE_SCOPES: Record<GoogleFeature, string> = { gmail: GOOGLE_SCOPES.gmailSend, calendar: GOOGLE_SCOPES.calendarEvents };

/** `?features=gmail,calendar` → known features, deduped; unknown values ignored. */
export function parseGoogleFeatures(value: string | null | undefined): GoogleFeature[] {
  const wanted = new Set((value ?? "").split(",").map((item) => item.trim().toLowerCase()));
  return GOOGLE_FEATURES.filter((feature) => wanted.has(feature));
}

/**
 * Scopes to request: base Drive scopes for the current mode plus the requested features.
 * Used with include_granted_scopes=true, so previously granted scopes are kept (incremental consent).
 */
export function googleScopes(features: readonly GoogleFeature[] = []): string[] {
  const base = ["openid", "email"];
  const drive = isGoogleDriveFullAccess()
    ? ["https://www.googleapis.com/auth/drive.readonly", "https://www.googleapis.com/auth/spreadsheets.readonly", "https://www.googleapis.com/auth/documents.readonly"]
    : [GOOGLE_SCOPES.driveFile];
  return [...new Set([...base, ...drive, ...features.map((feature) => FEATURE_SCOPES[feature])])];
}

/** Union of space-separated scope lists, order kept. */
export function mergeScopes(...lists: (string | null | undefined)[]): string {
  return [...new Set(lists.flatMap((list) => (list ?? "").split(/\s+/).filter(Boolean)))].join(" ");
}

export function scopesInclude(scopes: string | null | undefined, scope: string): boolean {
  return (scopes ?? "").split(/\s+/).includes(scope);
}

/** Features whose scope is in the granted list. */
export function grantedFeatures(scopes: string | null | undefined): GoogleFeature[] {
  return GOOGLE_FEATURES.filter((feature) => scopesInclude(scopes, FEATURE_SCOPES[feature]));
}

// ---------- Encryption ----------

function encryptionKey(raw = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY): Buffer {
  const key = raw ? Buffer.from(raw, "base64") : Buffer.alloc(0);
  if (key.length !== 32) throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY must be 32 bytes in base64.");
  return key;
}

/** "v1." + base64url(iv[12] | tag[16] | ciphertext). `keyBase64` defaults to GOOGLE_TOKEN_ENCRYPTION_KEY. */
export function encryptToken(plain: string, keyBase64?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(keyBase64), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1.${Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url")}`;
}

/** Throws when the value was altered, truncated or encrypted with another key (GCM auth tag check). */
export function decryptToken(encrypted: string, keyBase64?: string): string {
  if (!encrypted.startsWith("v1.")) throw new Error("Unknown token format.");
  const data = Buffer.from(encrypted.slice(3), "base64url");
  if (data.length < 12 + 16 + 1) throw new Error("Token is truncated.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(keyBase64), data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8");
}

// ---------- Files (pure helpers) ----------

function cleanFile(value: unknown): GoogleFile | null {
  if (!value || typeof value !== "object") return null;
  const file = value as Record<string, unknown>;
  const text = (key: string, max: number) => (typeof file[key] === "string" ? (file[key] as string).trim().slice(0, max) : "");
  const id = text("id", 200);
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(id)) return null;
  const url = text("url", 1000);
  return { id, name: text("name", 300) || id, mimeType: text("mimeType", 200), url: /^https:\/\//i.test(url) ? url : "", addedAt: text("addedAt", 40) };
}

export function parseFiles(value: unknown): GoogleFile[] {
  return Array.isArray(value) ? value.map(cleanFile).filter((file): file is GoogleFile => file !== null).slice(0, GOOGLE_MAX_FILES) : [];
}

/** Adds (or refreshes) files by id, newest first; throws GoogleFilesLimitError past GOOGLE_MAX_FILES. */
export function mergeFiles(existing: GoogleFile[], added: Omit<GoogleFile, "addedAt">[], now = new Date()): GoogleFile[] {
  const stamped = parseFiles(added.map((file) => ({ ...file, addedAt: now.toISOString() })));
  const ids = new Set(stamped.map((file) => file.id));
  const merged = [...stamped, ...existing.filter((file) => !ids.has(file.id))];
  if (merged.length > GOOGLE_MAX_FILES) throw new GoogleFilesLimitError();
  return merged;
}

// ---------- Persistence ----------

const quote = (value: string) => JSON.stringify(value);
const pbDate = (date: Date) => date.toISOString().replace("T", " ");

async function findRow(userId: string): Promise<ConnectionRow | null> {
  const result = await pocketBaseFetch<{ items: ConnectionRow[] }>(
    `/api/collections/${COLLECTION}/records?${new URLSearchParams({ filter: `user = ${quote(userId)}`, perPage: "1", skipTotal: "1" })}`,
  );
  return result.items[0] ?? null;
}

function toConnection(row: ConnectionRow): GoogleConnection {
  return {
    id: row.id,
    userId: row.user,
    googleEmail: row.google_email ?? "",
    googleSub: row.google_sub ?? "",
    scopes: row.scopes ?? "",
    files: parseFiles(row.files),
    accessExpiresAt: row.access_expires_at ? new Date(row.access_expires_at.replace(" ", "T")).toISOString() : null,
  };
}

const recordPath = (id: string) => `/api/collections/${COLLECTION}/records/${encodeURIComponent(id)}`;

export async function getConnection(userId: string): Promise<GoogleConnection | null> {
  const row = await findRow(userId);
  return row ? toConnection(row) : null;
}

export async function hasGmail(userId: string): Promise<boolean> {
  return scopesInclude((await findRow(userId))?.scopes, GOOGLE_SCOPES.gmailSend);
}

export async function hasCalendar(userId: string): Promise<boolean> {
  return scopesInclude((await findRow(userId))?.scopes, GOOGLE_SCOPES.calendarEvents);
}

export async function saveConnection(userId: string, data: SaveConnectionData): Promise<GoogleConnection> {
  const existing = await findRow(userId);
  const refreshToken = data.refreshToken?.trim();
  if (!refreshToken && !existing?.refresh_token_enc) throw new Error("Google did not return a refresh token.");
  const body: Record<string, unknown> = {
    user: userId,
    google_email: data.googleEmail.slice(0, 320),
    google_sub: data.googleSub.slice(0, 255),
    // Same Google account: keep earlier grants (incremental consent); a different account starts fresh.
    scopes: (existing && existing.google_sub === data.googleSub ? mergeScopes(existing.scopes, data.scopes) : mergeScopes(data.scopes)).slice(0, 2000),
    access_token_enc: encryptToken(data.accessToken),
    access_expires_at: pbDate(Number.isNaN(Date.parse(data.accessExpiresAt)) ? new Date() : new Date(data.accessExpiresAt)),
  };
  if (refreshToken) body.refresh_token_enc = encryptToken(refreshToken);
  if (!existing) body.files = [];
  const row = await pocketBaseFetch<ConnectionRow>(existing ? recordPath(existing.id) : `/api/collections/${COLLECTION}/records`, {
    method: existing ? "PATCH" : "POST",
    body: JSON.stringify(body),
  });
  return toConnection(row);
}

async function revoke(token: string) {
  try {
    await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      cache: "no-store",
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
  } catch {
    // Best effort: the user can still revoke from their Google account; the local row is deleted anyway.
  }
}

/** Revokes the grant at Google (best effort) and deletes the stored connection. */
export async function deleteConnection(userId: string): Promise<void> {
  const row = await findRow(userId);
  if (!row) return;
  const encrypted = row.refresh_token_enc || row.access_token_enc;
  if (encrypted) {
    try {
      await revoke(decryptToken(encrypted));
    } catch {
      // Undecryptable token (rotated key): nothing to revoke from here.
    }
  }
  await pocketBaseFetch(recordPath(row.id), { method: "DELETE" });
}

/** Stored access token while valid; otherwise refreshes it. invalid_grant → connection removed + GoogleNotConnectedError. */
export async function getValidAccessToken(userId: string): Promise<string> {
  const row = await findRow(userId);
  if (!row?.refresh_token_enc) throw new GoogleNotConnectedError();
  const expiresAt = row.access_expires_at ? Date.parse(row.access_expires_at.replace(" ", "T")) : 0;
  if (row.access_token_enc && expiresAt - EXPIRY_MARGIN_MS > Date.now()) {
    try {
      return decryptToken(row.access_token_enc);
    } catch {
      // Fall through to a refresh.
    }
  }

  let refreshToken: string;
  try {
    refreshToken = decryptToken(row.refresh_token_enc);
  } catch {
    await pocketBaseFetch(recordPath(row.id), { method: "DELETE" });
    throw new GoogleNotConnectedError();
  }
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Google OAuth is not configured.");

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
    cache: "no-store",
    signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
  });
  const payload = (await response.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; scope?: string; error?: string };
  if (!response.ok || !payload.access_token) {
    if (payload.error === "invalid_grant") {
      // Revoked or expired grant: the stored connection is useless.
      await pocketBaseFetch(recordPath(row.id), { method: "DELETE" });
      throw new GoogleNotConnectedError();
    }
    throw new Error(`Google token refresh failed (${response.status}).`);
  }
  await pocketBaseFetch(recordPath(row.id), {
    method: "PATCH",
    body: JSON.stringify({
      access_token_enc: encryptToken(payload.access_token),
      access_expires_at: pbDate(new Date(Date.now() + Math.max(0, payload.expires_in ?? 3600) * 1000)),
      ...(payload.scope ? { scopes: payload.scope.slice(0, 2000) } : {}),
    }),
  });
  return payload.access_token;
}

// ---------- Connected files ----------

async function requireRow(userId: string) {
  const row = await findRow(userId);
  if (!row) throw new GoogleNotConnectedError();
  return row;
}

export async function listFiles(userId: string): Promise<GoogleFile[]> {
  const row = await findRow(userId);
  return row ? parseFiles(row.files) : [];
}

export async function addFiles(userId: string, files: Omit<GoogleFile, "addedAt">[]): Promise<GoogleFile[]> {
  const row = await requireRow(userId);
  const merged = mergeFiles(parseFiles(row.files), files);
  await pocketBaseFetch(recordPath(row.id), { method: "PATCH", body: JSON.stringify({ files: merged }) });
  return merged;
}

export async function removeFile(userId: string, fileId: string): Promise<GoogleFile[]> {
  const row = await requireRow(userId);
  const current = parseFiles(row.files);
  const next = current.filter((file) => file.id !== fileId);
  if (next.length !== current.length) await pocketBaseFetch(recordPath(row.id), { method: "PATCH", body: JSON.stringify({ files: next }) });
  return next;
}
