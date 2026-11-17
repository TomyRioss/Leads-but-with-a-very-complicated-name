// Run: node --experimental-strip-types lib/server/mcp/oauth.selfcheck.mjs
// OAuth for the MCP connector: PKCE S256, redirect URIs, auth code sign/verify/expiry/tamper, CIMD URL guard, DCR.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { register } from "node:module";
import { pathToFileURL } from "node:url";

const root = pathToFileURL(new URL("../../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")).href;
const hooks = `export async function resolve(specifier, context, next) {
  // PocketBase stubbed: this check never touches the database.
  if (specifier === "@/lib/server/pocketbase") return { url: "data:text/javascript," + encodeURIComponent("const no = async () => { throw new Error('no db in selfcheck'); }; export class PocketBaseRequestError extends Error {} export class PocketBaseAuthError extends Error {} export const isPocketBaseConfigured = () => false; export const pocketBaseFetch = no, pocketBasePublicFetch = no, createLeadRecords = no;"), shortCircuit: true };
  if (specifier.startsWith("@/")) return next(${JSON.stringify(root)} + specifier.slice(2) + ".ts", context);
  return next(specifier, context);
}`;
register(`data:text/javascript,${encodeURIComponent(hooks)}`);

process.env.EMAIL_VERIFICATION_SECRET = "selfcheck-secret";
delete process.env.APP_URL;
const oauth = await import("./oauth.ts");

// PKCE S256 (RFC 7636 appendix B vector).
const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
assert.equal(createHash("sha256").update(verifier).digest("base64url"), challenge);
assert.equal(oauth.verifyPkce(verifier, challenge), true);
assert.equal(oauth.verifyPkce(verifier.slice(0, -1) + "d", challenge), false);
assert.equal(oauth.verifyPkce("short", challenge), false);
assert.equal(oauth.verifyPkce(verifier, challenge.slice(1)), false);

// Redirect URIs.
for (const ok of ["https://claude.ai/api/mcp/auth_callback", "https://chatgpt.com/connector_platform_oauth_redirect", "http://localhost:6274/oauth/callback", "http://127.0.0.1/cb"]) {
  assert.equal(oauth.isAllowedRedirectUri(ok), true, ok);
}
for (const bad of ["http://example.com/cb", "https://a.com/cb#frag", "https://user:pw@a.com/cb", "myapp://cb", "javascript:alert(1)", "https://a.com/ cb", "", 42, null, `https://a.com/${"x".repeat(600)}`, "http://localhost.evil.com/cb", "http://[::1]/cb"]) {
  assert.equal(oauth.isAllowedRedirectUri(bad), false, String(bad));
}

// Scopes.
assert.deepEqual(oauth.parseRequestedScopes(""), ["read", "write", "credits", "send"]);
assert.deepEqual(oauth.parseRequestedScopes("send read bogus"), ["read", "send"]);
assert.equal(oauth.parseRequestedScopes("admin"), null);

// DCR: stateless client id round-trips through resolveClient; tampering and invalid metadata are rejected.
const reg = oauth.registerClient({ client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"], token_endpoint_auth_method: "none" });
assert.equal(reg.status, 201);
assert.equal(reg.body.token_endpoint_auth_method, "none");
const client = await oauth.resolveClient(reg.body.client_id);
assert.deepEqual(client, { clientId: reg.body.client_id, clientName: "Claude", clientUri: null, redirectUris: ["https://claude.ai/api/mcp/auth_callback"] });
assert.equal(await oauth.resolveClient(reg.body.client_id.slice(0, -2) + "xx"), null);
assert.equal(await oauth.resolveClient("random"), null);
assert.equal(oauth.registerClient({ redirect_uris: [] }).error, "invalid_redirect_uri");
assert.equal(oauth.registerClient({ redirect_uris: Array(6).fill("https://a.com/cb") }).error, "invalid_redirect_uri");
assert.equal(oauth.registerClient({ redirect_uris: ["http://evil.com/cb"] }).error, "invalid_redirect_uri");
assert.equal(oauth.registerClient({ redirect_uris: ["https://a.com/cb"], grant_types: ["client_credentials"] }).error, "invalid_client_metadata");

// Authorization request validation (DCR client, no network).
const issuer = "https://leadta.test";
const params = (extra = {}) => new URLSearchParams({
  response_type: "code", client_id: reg.body.client_id, redirect_uri: "https://claude.ai/api/mcp/auth_callback",
  code_challenge: challenge, code_challenge_method: "S256", state: "xyz", scope: "read write", resource: `${issuer}/api/mcp`, ...extra,
});
const valid = await oauth.validateAuthorizationRequest(params(), issuer);
assert.equal(valid.ok, true);
assert.deepEqual(valid.value.scopes, ["read", "write"]);
assert.equal(valid.value.resource, `${issuer}/api/mcp`);
assert.equal((await oauth.validateAuthorizationRequest(params({ redirect_uri: "https://claude.ai/other" }), issuer)).detail, "redirect_uri");
assert.equal((await oauth.validateAuthorizationRequest(params({ code_challenge_method: "plain" }), issuer)).detail, "code_challenge_method");
assert.equal((await oauth.validateAuthorizationRequest(params({ resource: "https://evil.test/api/mcp" }), issuer)).detail, "resource");
assert.equal((await oauth.validateAuthorizationRequest(params({ response_type: "token" }), issuer)).detail, "response_type");
const dup = params();
dup.append("state", "again");
assert.equal((await oauth.validateAuthorizationRequest(dup, issuer)).detail, "state");
const noRedirect = params();
noRedirect.delete("redirect_uri"); // single registered URI is the default
assert.equal((await oauth.validateAuthorizationRequest(noRedirect, issuer)).ok, true);

// Redirect back.
const back = new URL(oauth.authorizationRedirect(valid.value, issuer, { error: "access_denied" }));
assert.equal(back.searchParams.get("error"), "access_denied");
assert.equal(back.searchParams.get("state"), "xyz");
assert.equal(back.searchParams.get("iss"), issuer);

// Auth codes: sign/verify, expiry (60 s) and tamper.
const now = Date.UTC(2026, 10, 16, 12, 0, 0);
const code = oauth.issueAuthorizationCode({ userId: "abcdefghijklmno", request: valid.value, scopes: ["read"] }, now);
const payload = oauth.verifyAuthorizationCode(code, now + 59_000);
assert.equal(payload.uid, "abcdefghijklmno");
assert.equal(payload.sc, "read");
assert.equal(payload.ru, "https://claude.ai/api/mcp/auth_callback");
assert.equal(payload.cid, createHash("sha256").update(reg.body.client_id).digest("base64url"));
assert.equal(oauth.verifyAuthorizationCode(code, now + 60_001), null);
const [body, sig] = code.split(".");
const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), uid: "zzzzzzzzzzzzzzz" })).toString("base64url");
assert.equal(oauth.verifyAuthorizationCode(`${forged}.${sig}`, now), null);
// Always a different last char (a fixed "A" is a no-op when the signature already ends in "A").
assert.equal(oauth.verifyAuthorizationCode(`${body}.${sig.slice(0, -1)}${sig.endsWith("A") ? "B" : "A"}`, now), null);
assert.equal(oauth.verifyAuthorizationCode("", now), null);
// A client_id signature can't be replayed as a code (purpose-bound keys).
assert.equal(oauth.verifyAuthorizationCode(reg.body.client_id.slice(4), now), null);

// Token exchange checks that run before any database write.
const tokenParams = (extra = {}) => new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: reg.body.client_id, redirect_uri: valid.value.redirectUri, ...extra });
const realNow = Date.now();
const liveCode = oauth.issueAuthorizationCode({ userId: "abcdefghijklmno", request: valid.value, scopes: ["read"] }, realNow);
assert.equal((await oauth.exchangeAuthorizationCode(tokenParams({ code: liveCode, code_verifier: "x".repeat(43) }), issuer, realNow)).error, "invalid_grant");
assert.equal((await oauth.exchangeAuthorizationCode(tokenParams({ code: liveCode, client_id: "other" }), issuer, realNow)).error, "invalid_grant");
assert.equal((await oauth.exchangeAuthorizationCode(tokenParams({ code: liveCode, redirect_uri: "https://claude.ai/x" }), issuer, realNow)).error, "invalid_grant");
assert.equal((await oauth.exchangeAuthorizationCode(tokenParams({ code: liveCode, resource: "https://evil.test/api/mcp" }), issuer, realNow)).error, "invalid_target");
assert.equal((await oauth.exchangeAuthorizationCode(tokenParams(), issuer, now + 61_000)).error, "invalid_grant");
await assert.rejects(oauth.exchangeAuthorizationCode(tokenParams({ code: liveCode }), issuer, realNow), /no db in selfcheck/); // valid → would persist
assert.equal(await oauth.verifyMcpAccessToken("not-a-token"), null); // shape check before any lookup

// CIMD URL guard.
for (const ok of ["https://claude.ai/oauth/mcp-client-metadata.json", "https://app.example-client.com/client"]) {
  assert.equal(oauth.isAllowedClientMetadataUrl(ok), true, ok);
}
for (const bad of [
  "http://claude.ai/client", "https://claude.ai/", "https://claude.ai", "https://127.0.0.1/client", "https://[::1]/client",
  "https://10.0.0.5/client", "https://2130706433/client", "https://localhost/client", "https://api.localhost/client",
  "https://metadata.internal/client", "https://printer.local/client", "https://intranet/client", "https://claude.ai:8443/client",
  "https://user@claude.ai/client", "https://claude.ai/client#x", "https://CLAUDE.ai/client", "https://claude.ai./client",
  `https://claude.ai/${"x".repeat(2000)}`,
]) {
  assert.equal(oauth.isAllowedClientMetadataUrl(bad), false, bad);
}
for (const pub of ["8.8.8.8", "104.18.32.7", "2606:4700::6810:84e5", "::ffff:8.8.8.8"]) assert.equal(oauth.isPublicAddress(pub), true, pub);
for (const priv of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "2001:db8::1", "64:ff9b::a00:1"]) {
  assert.equal(oauth.isPublicAddress(priv), false, priv);
}

// CIMD document validation.
const url = "https://client.example-app.com/oauth/client.json";
const doc = { client_id: url, client_name: "Example", redirect_uris: ["https://client.example-app.com/cb"], token_endpoint_auth_method: "none" };
assert.deepEqual(oauth.parseClientMetadataDocument(doc, url), { clientId: url, clientName: "Example", clientUri: null, redirectUris: ["https://client.example-app.com/cb"] });
assert.equal(oauth.parseClientMetadataDocument({ ...doc, client_id: "https://other.com/c" }, url), null);
assert.equal(oauth.parseClientMetadataDocument({ ...doc, redirect_uris: ["http://evil.com/cb"] }, url), null);
assert.equal(oauth.parseClientMetadataDocument({ ...doc, token_endpoint_auth_method: "client_secret_basic" }, url), null);
assert.equal(oauth.parseClientMetadataDocument({ ...doc, client_name: undefined }, url), null);

console.log("mcp oauth selfcheck ok");
