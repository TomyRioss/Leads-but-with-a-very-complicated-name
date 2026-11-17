// OAuth 2.1 authorization server for the leadta MCP connector (claude.ai, ChatGPT…).
// Public clients only (PKCE S256), stateless client ids (signed DCR blobs or CIMD URLs) and stateless auth codes;
// only grants (hashed tokens) are persisted, in the superuser-only `mcp_grants` collection.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { pocketBaseFetch, PocketBaseRequestError } from "@/lib/server/pocketbase";

export type McpScope = "read" | "write" | "credits" | "send";
export const MCP_SCOPES: readonly McpScope[] = ["read", "write", "credits", "send"];

const CODE_TTL_MS = 60_000;
const ACCESS_TTL_S = 60 * 60;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60_000;
const LAST_USED_EVERY_MS = 5 * 60_000;
const MAX_REDIRECT_URIS = 5;
const MAX_REDIRECT_URI = 512;
const MAX_CLIENT_ID = 2000;
const MAX_CLIENT_NAME = 100;
const MAX_CLIENT_URI = 300;
const MAX_STATE = 1000;
const MAX_BODY_BYTES = 16_384;
const CIMD_MAX_BYTES = 10_240;
const CIMD_TIMEOUT_MS = 5000;
const CIMD_CACHE_MS = 5 * 60_000;
const CIMD_CACHE_MAX = 100;

export type OAuthClient = { clientId: string; clientName: string; clientUri: string | null; redirectUris: string[] };
export type OAuthFailure = { error: string; error_description?: string; status?: number };
export type TokenResponse = { access_token: string; token_type: "Bearer"; expires_in: number; refresh_token: string; scope: string };

const fail = (error: string, error_description?: string, status?: number): OAuthFailure => ({ error, error_description, status });
export const isFailure = (value: object): value is OAuthFailure => "error" in value;

// ── Origin ───────────────────────────────────────────────────────────────────

/** Issuer / public origin: APP_URL when configured (production), else the request origin (development). */
export function oauthIssuer(request: Request) {
  const configured = process.env.APP_URL?.trim();
  if (!configured) return new URL(request.url).origin;
  const url = new URL(configured);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") throw new Error("APP_URL must use HTTPS.");
  return url.origin;
}

/** The MCP endpoint as an RFC 8707 resource identifier. */
export const mcpResourceUrl = (issuer: string) => `${issuer}/api/mcp`;

// ── Signing ──────────────────────────────────────────────────────────────────

function signingKey(purpose: "client" | "code") {
  // Purpose-bound derivation of an existing server secret (same approach as lead-suite-agent), no new env var.
  const secret = process.env.EMAIL_VERIFICATION_SECRET || process.env.POCKETBASE_SUPERUSER_PASSWORD;
  if (!secret) throw new Error("No server secret configured to sign OAuth artifacts.");
  return createHmac("sha256", secret).update(`leadta:mcp-oauth-${purpose}:v1`).digest();
}

const b64 = (value: string) => Buffer.from(value).toString("base64url");
const mac = (purpose: "client" | "code", body: string) => createHmac("sha256", signingKey(purpose)).update(body).digest("base64url");
const sha256Hex = (value: string) => createHash("sha256").update(value).digest("hex");
const sha256B64 = (value: string) => createHash("sha256").update(value).digest("base64url");

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function seal(purpose: "client" | "code", payload: object) {
  const body = b64(JSON.stringify(payload));
  return `${body}.${mac(purpose, body)}`;
}

function unseal(purpose: "client" | "code", token: string): Record<string, unknown> | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  if (!safeEqual(token.slice(dot + 1), mac(purpose, body))) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// ── PKCE, redirect URIs, scopes ──────────────────────────────────────────────

const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;
const UNSAFE_CHARS_RE = /[\s\x00-\x1f\x7f]/;

/** RFC 7636 S256: BASE64URL(SHA256(verifier)) compared in constant time. */
export function verifyPkce(verifier: string, challenge: string) {
  return VERIFIER_RE.test(verifier) && CHALLENGE_RE.test(challenge) && safeEqual(sha256B64(verifier), challenge);
}

/** https://… anywhere, or http only on localhost / 127.0.0.1; no fragment, userinfo, whitespace or custom schemes. */
export function isAllowedRedirectUri(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > MAX_REDIRECT_URI || UNSAFE_CHARS_RE.test(value) || value.includes("#")) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  if (url.protocol === "https:") return Boolean(url.hostname);
  if (url.protocol === "http:") return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  return false;
}

/** Requested scopes ∩ supported, in canonical order; empty request → all supported; only unknown scopes → null. */
export function parseRequestedScopes(raw: string): McpScope[] | null {
  const requested = raw.split(" ").filter(Boolean);
  if (requested.length === 0) return [...MCP_SCOPES];
  const granted = MCP_SCOPES.filter((scope) => requested.includes(scope));
  return granted.length > 0 ? granted : null;
}

const scopeList = (raw: string | undefined) => MCP_SCOPES.filter((scope) => (raw ?? "").split(" ").includes(scope));

const cleanName = (value: string) => value.replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, MAX_CLIENT_NAME);

function optionalClientUri(value: unknown) {
  if (typeof value !== "string" || value.length > MAX_CLIENT_URI || UNSAFE_CHARS_RE.test(value)) return null;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

/** One value per parameter (RFC 6749 §3.1): "" when absent, null when repeated. */
function single(params: URLSearchParams, name: string) {
  const values = params.getAll(name);
  return values.length > 1 ? null : (values[0] ?? "");
}

// ── Clients: Dynamic Client Registration (stateless) ─────────────────────────

const DCR_PREFIX = "ltc_";

/** RFC 7591 registration. The client_id is a signed blob of the metadata, so nothing is stored. */
export function registerClient(input: unknown, now = Date.now()): { status: 201; body: Record<string, unknown> } | OAuthFailure {
  if (!input || typeof input !== "object" || Array.isArray(input)) return fail("invalid_client_metadata", "Body must be a JSON object.");
  const body = input as Record<string, unknown>;
  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > MAX_REDIRECT_URIS) {
    return fail("invalid_redirect_uri", `redirect_uris must list 1 to ${MAX_REDIRECT_URIS} URIs.`);
  }
  if (!uris.every(isAllowedRedirectUri)) return fail("invalid_redirect_uri", "Redirect URIs must be https, or http on localhost/127.0.0.1, without fragment.");
  const redirectUris = [...new Set(uris as string[])];
  const grantTypes = body.grant_types;
  if (grantTypes !== undefined && (!Array.isArray(grantTypes) || !grantTypes.every((g) => g === "authorization_code" || g === "refresh_token"))) {
    return fail("invalid_client_metadata", "Only authorization_code and refresh_token grants are supported.");
  }
  const responseTypes = body.response_types;
  if (responseTypes !== undefined && (!Array.isArray(responseTypes) || !responseTypes.every((r) => r === "code"))) {
    return fail("invalid_client_metadata", "Only the code response type is supported.");
  }
  const clientName = (typeof body.client_name === "string" ? cleanName(body.client_name) : "") || new URL(redirectUris[0]).host;
  const clientUri = optionalClientUri(body.client_uri);
  const iat = Math.floor(now / 1000);
  const clientId = DCR_PREFIX + seal("client", { v: 1, ru: redirectUris, cn: clientName, cu: clientUri ?? undefined, iat });
  if (clientId.length > MAX_CLIENT_ID) return fail("invalid_client_metadata", "Client metadata is too large.");
  return {
    status: 201,
    body: {
      client_id: clientId,
      client_id_issued_at: iat,
      client_name: clientName,
      ...(clientUri ? { client_uri: clientUri } : {}),
      redirect_uris: redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
  };
}

function decodeRegisteredClient(clientId: string): OAuthClient | null {
  const payload = unseal("client", clientId.slice(DCR_PREFIX.length));
  if (!payload || payload.v !== 1 || !Array.isArray(payload.ru) || typeof payload.cn !== "string") return null;
  const redirectUris = payload.ru.filter(isAllowedRedirectUri);
  if (redirectUris.length === 0) return null;
  return { clientId, clientName: payload.cn, clientUri: optionalClientUri(payload.cu), redirectUris };
}

// ── Clients: Client ID Metadata Documents ────────────────────────────────────

const BLOCKED_SUFFIX_RE = /(^|\.)(localhost|local|localdomain|internal|intranet|lan|home|corp|private|test|example|invalid|onion|arpa)$/;

/** Syntactic SSRF guard for a CIMD client_id: canonical https URL with a path, a public DNS name, default port. */
export function isAllowedClientMetadataUrl(value: string) {
  if (!value.startsWith("https://") || value.length > MAX_CLIENT_ID || UNSAFE_CHARS_RE.test(value) || value.includes("#")) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.href !== value || url.username || url.password || url.port || url.pathname === "/") return false;
  const host = url.hostname;
  if (!host || host.startsWith("[") || isIP(host) || !host.includes(".") || host.endsWith(".")) return false;
  return !BLOCKED_SUFFIX_RE.test(host);
}

/** Global unicast only: rejects loopback, private, CGNAT, link-local, multicast, documentation and mapped ranges. */
export function isPublicAddress(address: string) {
  const v4 = isIP(address) === 4 ? address : address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (v4) {
    const [a, b, c] = v4.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)))) return false;
    if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    return true;
  }
  if (isIP(address) !== 6) return false;
  const first = address.toLowerCase().split(":")[0];
  if (!/^[23][0-9a-f]{3}$/.test(first)) return false; // 2000::/3 only (also drops ::, ::1, fc00::/7, fe80::/10, ff00::/8)
  const lower = address.toLowerCase();
  return !(first === "2002" || lower.startsWith("2001:db8:") || lower.startsWith("2001:0:") || lower.startsWith("2001::"));
}

async function resolvesToPublicAddresses(host: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const addresses = await Promise.race([
      lookup(host, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("dns timeout")), CIMD_TIMEOUT_MS); }),
    ]);
    return addresses.length > 0 && addresses.every((entry) => isPublicAddress(entry.address));
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function readCapped(response: Response, max: number) {
  if (Number(response.headers.get("content-length") || 0) > max || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** Validates a fetched CIMD document against the URL it was fetched from. */
export function parseClientMetadataDocument(doc: unknown, url: string): OAuthClient | null {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
  const body = doc as Record<string, unknown>;
  if (body.client_id !== url) return null;
  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > MAX_REDIRECT_URIS || !uris.every(isAllowedRedirectUri)) return null;
  if (typeof body.client_name !== "string" || body.client_name.length > 200) return null;
  if (body.token_endpoint_auth_method !== undefined && body.token_endpoint_auth_method !== "none") return null;
  const clientName = cleanName(body.client_name);
  if (!clientName) return null;
  return { clientId: url, clientName, clientUri: optionalClientUri(body.client_uri), redirectUris: [...new Set(uris as string[])] };
}

const cimdCache = new Map<string, { client: OAuthClient; expires: number }>();

async function fetchClientMetadata(url: string): Promise<OAuthClient | null> {
  const cached = cimdCache.get(url);
  if (cached && cached.expires > Date.now()) return cached.client;
  cimdCache.delete(url);
  // DNS is checked before fetching; the fetch re-resolves, so https + no redirects remain the main barrier.
  if (!(await resolvesToPublicAddresses(new URL(url).hostname))) return null;
  let text: string | null;
  try {
    const response = await fetch(url, {
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(CIMD_TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    text = await readCapped(response, CIMD_MAX_BYTES);
  } catch {
    return null;
  }
  if (text === null) return null;
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return null;
  }
  const client = parseClientMetadataDocument(doc, url);
  if (client) {
    if (cimdCache.size >= CIMD_CACHE_MAX) cimdCache.delete(cimdCache.keys().next().value!);
    cimdCache.set(url, { client, expires: Date.now() + CIMD_CACHE_MS });
  }
  return client;
}

/** Resolves a DCR client id (signature check) or a CIMD URL (guarded fetch); null when unknown or invalid. */
export async function resolveClient(clientId: string): Promise<OAuthClient | null> {
  if (!clientId || clientId.length > MAX_CLIENT_ID) return null;
  if (clientId.startsWith(DCR_PREFIX)) return decodeRegisteredClient(clientId);
  if (isAllowedClientMetadataUrl(clientId)) return fetchClientMetadata(clientId);
  return null;
}

// ── Authorization request ────────────────────────────────────────────────────

export type AuthorizationRequest = {
  client: OAuthClient;
  redirectUri: string;
  scopes: McpScope[];
  state: string;
  codeChallenge: string;
  resource: string;
};

/** Canonical MCP resource for an optional RFC 8707 `resource` value (trailing slash tolerated); null when foreign. */
export function canonicalResource(raw: string, issuer: string) {
  const expected = mcpResourceUrl(issuer);
  if (!raw) return expected;
  return raw === expected || raw === `${expected}/` ? expected : null;
}

/**
 * Validates the authorization request parameters. `detail` names the failing parameter. Errors are never redirected:
 * the consent page shows them, so an unvalidated redirect_uri is never used.
 */
export async function validateAuthorizationRequest(params: URLSearchParams, issuer: string): Promise<{ ok: true; value: AuthorizationRequest } | { ok: false; detail: string }> {
  const get = (name: string) => single(params, name);
  const bad = (detail: string) => ({ ok: false as const, detail });
  if (get("response_type") !== "code") return bad("response_type");
  const clientId = get("client_id");
  if (!clientId) return bad("client_id");
  const client = await resolveClient(clientId);
  if (!client) return bad("client_id");
  let redirectUri = get("redirect_uri");
  if (redirectUri === null) return bad("redirect_uri");
  if (!redirectUri && client.redirectUris.length === 1) redirectUri = client.redirectUris[0];
  if (!client.redirectUris.includes(redirectUri)) return bad("redirect_uri");
  const codeChallenge = get("code_challenge");
  if (!codeChallenge || !CHALLENGE_RE.test(codeChallenge)) return bad("code_challenge");
  if (get("code_challenge_method") !== "S256") return bad("code_challenge_method");
  const state = get("state");
  if (state === null || state.length > MAX_STATE) return bad("state");
  const rawScope = get("scope");
  const scopes = rawScope === null || rawScope.length > 200 ? null : parseRequestedScopes(rawScope);
  if (!scopes) return bad("scope");
  const rawResource = get("resource");
  const resource = rawResource === null ? null : canonicalResource(rawResource, issuer);
  if (!resource) return bad("resource");
  return { ok: true, value: { client, redirectUri, scopes, state, codeChallenge, resource } };
}

/** Redirect back to the client: `code` (+ state, iss) on allow, `error=access_denied` on deny. */
export function authorizationRedirect(request: AuthorizationRequest, issuer: string, outcome: { code: string } | { error: "access_denied" }) {
  const url = new URL(request.redirectUri);
  if ("code" in outcome) url.searchParams.set("code", outcome.code);
  else url.searchParams.set("error", outcome.error);
  if (request.state) url.searchParams.set("state", request.state);
  url.searchParams.set("iss", issuer);
  return url.toString();
}

// ── Authorization codes (stateless, single use enforced by mcp_grants.code_hash) ──

type CodePayload = { uid: string; cid: string; cn: string; ru: string; sc: string; cc: string; res: string; exp: number };

export function issueAuthorizationCode(
  input: { userId: string; request: AuthorizationRequest; scopes: McpScope[] },
  now = Date.now(),
) {
  const { userId, request, scopes } = input;
  return seal("code", {
    v: 1,
    uid: userId,
    cid: sha256B64(request.client.clientId), // the token request carries the full client_id
    cn: request.client.clientName,
    ru: request.redirectUri,
    sc: scopes.join(" "),
    cc: request.codeChallenge,
    res: request.resource,
    n: randomBytes(16).toString("base64url"),
    exp: now + CODE_TTL_MS,
  });
}

export function verifyAuthorizationCode(code: string, now = Date.now()): CodePayload | null {
  if (!code || code.length > 4096) return null;
  const p = unseal("code", code);
  if (!p || p.v !== 1 || typeof p.exp !== "number" || p.exp <= now) return null;
  const fields = ["uid", "cid", "cn", "ru", "sc", "cc", "res"] as const;
  if (!fields.every((field) => typeof p[field] === "string")) return null;
  return p as unknown as CodePayload;
}

// ── Grants (PocketBase) ──────────────────────────────────────────────────────

const GRANTS = "/api/collections/mcp_grants/records";
const GRANT_FIELDS = "id,user,client_id,client_name,scopes,revoked_at,access_expires_at,refresh_expires_at,last_used_at";
type GrantRow = {
  id: string;
  user: string;
  client_id: string;
  client_name: string;
  scopes: string;
  revoked_at: string;
  access_expires_at: string;
  refresh_expires_at: string;
  last_used_at: string;
  created?: string;
};

const q = (value: string) => JSON.stringify(value);
const timeOf = (value: string | undefined) => (value ? Date.parse(value.replace(" ", "T")) : Number.NaN);
const isoOf = (value: string | undefined) => (value ? new Date(timeOf(value)).toISOString() : null);
const ACCESS_RE = /^lta_[A-Za-z0-9_-]{43}$/;
const REFRESH_RE = /^ltr_[A-Za-z0-9_-]{43}$/;
const GRANT_ID_RE = /^[a-z0-9]{15}$/;

async function findGrant(filter: string, fields = GRANT_FIELDS) {
  const params = new URLSearchParams({ filter, perPage: "1", skipTotal: "1", fields });
  return (await pocketBaseFetch<{ items: GrantRow[] }>(`${GRANTS}?${params}`)).items[0] ?? null;
}

const patchGrant = (id: string, body: Record<string, unknown>) =>
  pocketBaseFetch(`${GRANTS}/${id}`, { method: "PATCH", body: JSON.stringify(body) });

const revokeGrant = (id: string) => patchGrant(id, { revoked_at: new Date().toISOString() });

function newTokens(now: number) {
  const access = `lta_${randomBytes(32).toString("base64url")}`;
  const refresh = `ltr_${randomBytes(32).toString("base64url")}`;
  return {
    access,
    refresh,
    columns: {
      access_hash: sha256Hex(access),
      refresh_hash: sha256Hex(refresh),
      access_expires_at: new Date(now + ACCESS_TTL_S * 1000).toISOString(),
      refresh_expires_at: new Date(now + REFRESH_TTL_MS).toISOString(),
    },
  };
}

const tokenResponse = (tokens: { access: string; refresh: string }, scopes: string): TokenResponse => ({
  access_token: tokens.access,
  token_type: "Bearer",
  expires_in: ACCESS_TTL_S,
  refresh_token: tokens.refresh,
  scope: scopes,
});

/** grant_type=authorization_code: verifies code, client, redirect_uri, PKCE and resource, then creates the grant. */
export async function exchangeAuthorizationCode(params: URLSearchParams, issuer: string, now = Date.now()): Promise<TokenResponse | OAuthFailure> {
  const code = single(params, "code");
  const verifier = single(params, "code_verifier");
  const clientId = single(params, "client_id");
  const redirectUri = single(params, "redirect_uri");
  const resource = single(params, "resource");
  if (!code || !verifier || !clientId || redirectUri === null || resource === null) return fail("invalid_request", "code, code_verifier and client_id are required once.");
  const payload = verifyAuthorizationCode(code, now);
  if (!payload) return fail("invalid_grant", "The authorization code is invalid or expired.");
  if (!safeEqual(sha256B64(clientId), payload.cid)) return fail("invalid_grant", "The code was issued to another client.");
  if (redirectUri && redirectUri !== payload.ru) return fail("invalid_grant", "redirect_uri does not match.");
  if (!verifyPkce(verifier, payload.cc)) return fail("invalid_grant", "PKCE verification failed.");
  if (resource && canonicalResource(resource, issuer) !== payload.res) return fail("invalid_target", "resource does not match.");

  const codeHash = sha256Hex(code);
  const tokens = newTokens(now);
  try {
    await pocketBaseFetch(GRANTS, {
      method: "POST",
      body: JSON.stringify({
        user: payload.uid,
        client_id: clientId,
        client_name: payload.cn,
        redirect_uri: payload.ru,
        scopes: payload.sc,
        code_hash: codeHash,
        ...tokens.columns,
      }),
    });
  } catch (error) {
    if (!(error instanceof PocketBaseRequestError) || error.status !== 400) throw error;
    if (error.detail.includes("validation_not_unique")) {
      // Code replay (RFC 6749 §4.1.2): revoke whatever the first exchange issued.
      const used = await findGrant(`code_hash = ${q(codeHash)} && revoked_at = ""`, "id");
      if (used) await revokeGrant(used.id);
      return fail("invalid_grant", "The authorization code was already used.");
    }
    return fail("invalid_grant", "The authorization code can no longer be used."); // e.g. the user was deleted
  }
  return tokenResponse(tokens, payload.sc);
}

/** grant_type=refresh_token: rotates both tokens; a reused (rotated) refresh token revokes the grant. */
export async function refreshAccessToken(params: URLSearchParams, now = Date.now()): Promise<TokenResponse | OAuthFailure> {
  const refresh = single(params, "refresh_token");
  const clientId = single(params, "client_id");
  const scope = single(params, "scope");
  if (!refresh || !clientId || scope === null) return fail("invalid_request", "refresh_token and client_id are required once.");
  if (!REFRESH_RE.test(refresh)) return fail("invalid_grant", "The refresh token is invalid.");
  const hash = sha256Hex(refresh);
  const grant = await findGrant(`refresh_hash = ${q(hash)}`);
  if (!grant) {
    const reused = await findGrant(`previous_refresh_hash = ${q(hash)} && revoked_at = ""`, "id");
    if (reused) await revokeGrant(reused.id);
    return fail("invalid_grant", "The refresh token is invalid.");
  }
  if (grant.revoked_at || grant.client_id !== clientId || !(timeOf(grant.refresh_expires_at) > now)) {
    return fail("invalid_grant", "The refresh token is invalid.");
  }
  const granted = scopeList(grant.scopes);
  if (scope && !scope.split(" ").filter(Boolean).every((item) => (granted as string[]).includes(item))) {
    return fail("invalid_scope", "Requested scope exceeds the grant.");
  }
  const tokens = newTokens(now);
  await patchGrant(grant.id, { ...tokens.columns, previous_refresh_hash: hash });
  return tokenResponse(tokens, granted.join(" "));
}

/** RFC 7009: revokes the grant behind an access or refresh token. Unknown tokens are ignored. */
export async function revokeToken(token: string, clientId: string) {
  const column = ACCESS_RE.test(token) ? "access_hash" : REFRESH_RE.test(token) ? "refresh_hash" : null;
  if (!column) return;
  const grant = await findGrant(`${column} = ${q(sha256Hex(token))} && revoked_at = ""`, "id,client_id");
  if (grant && (!clientId || clientId === grant.client_id)) await revokeGrant(grant.id);
}

/**
 * Bearer token check for the MCP route. null = invalid, expired or revoked (answer 401);
 * throws when PocketBase is unavailable (answer 503).
 */
export async function verifyMcpAccessToken(token: string): Promise<{ userId: string; scopes: McpScope[]; grantId: string; clientId: string; clientName: string } | null> {
  if (!ACCESS_RE.test(token)) return null;
  const grant = await findGrant(`access_hash = ${q(sha256Hex(token))}`);
  const now = Date.now();
  if (!grant || grant.revoked_at || !(timeOf(grant.access_expires_at) > now)) return null;
  const lastUsed = timeOf(grant.last_used_at);
  if (!(lastUsed > now - LAST_USED_EVERY_MS)) {
    await patchGrant(grant.id, { last_used_at: new Date(now).toISOString() }).catch(() => undefined);
  }
  return { userId: grant.user, scopes: scopeList(grant.scopes), grantId: grant.id, clientId: grant.client_id, clientName: grant.client_name };
}

/** Connected apps of a user (settings UI): live grants, newest first. */
export async function listUserGrants(userId: string) {
  const params = new URLSearchParams({
    filter: `user = ${q(userId)} && revoked_at = "" && refresh_expires_at > @now`,
    sort: "-created",
    perPage: "50",
    skipTotal: "1",
    fields: "id,client_name,scopes,created,last_used_at",
  });
  const { items } = await pocketBaseFetch<{ items: GrantRow[] }>(`${GRANTS}?${params}`);
  return items.map((row) => ({
    id: row.id,
    clientName: row.client_name,
    scopes: scopeList(row.scopes),
    createdAt: isoOf(row.created),
    lastUsedAt: isoOf(row.last_used_at),
  }));
}

/** Revokes one of the user's grants; false when it doesn't exist, isn't theirs or is already revoked. */
export async function revokeUserGrant(userId: string, grantId: string) {
  if (!GRANT_ID_RE.test(grantId)) return false;
  const grant = await findGrant(`id = ${q(grantId)} && user = ${q(userId)} && revoked_at = ""`, "id");
  if (!grant) return false;
  await revokeGrant(grant.id);
  return true;
}

// ── Request / response helpers ───────────────────────────────────────────────

/** Token, registration and revocation endpoints are called by browser-based clients too; they never use cookies. */
const OAUTH_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};

export const oauthJson = (body: object, status = 200) =>
  Response.json(body, { status, headers: { ...OAUTH_CORS, "Cache-Control": "no-store", Pragma: "no-cache" } });

export const oauthPreflight = () => new Response(null, { status: 204, headers: OAUTH_CORS });

export function oauthError(failure: OAuthFailure) {
  const { status, ...body } = failure;
  return oauthJson(body, status ?? 400);
}

/** Token/revoke bodies: form-urlencoded (spec) or JSON with string values. null when unreadable. */
export async function readOAuthParams(request: Request): Promise<URLSearchParams | null> {
  if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) return null;
  const type = request.headers.get("content-type")?.toLowerCase() ?? "";
  let text: string;
  try {
    text = await request.text();
  } catch {
    return null;
  }
  if (text.length > MAX_BODY_BYTES) return null;
  if (type.startsWith("application/x-www-form-urlencoded")) return new URLSearchParams(text);
  if (!type.startsWith("application/json")) return null;
  try {
    const body: unknown = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) return null;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(body)) if (typeof value === "string") params.set(key, value);
    return params;
  } catch {
    return null;
  }
}

/** JSON object body capped at 16 KB; null when missing, oversized or malformed. */
export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) return null;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return null;
    const body: unknown = JSON.parse(text);
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
