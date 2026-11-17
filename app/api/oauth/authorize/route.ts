// Backend of the OAuth consent page (app/[locale]/oauth/authorize): same-origin, session cookie, paid plan.
import { NextResponse } from "next/server";
import { getCurrentUser, withRefreshedSession } from "@/lib/server/auth";
import { rateLimited } from "@/lib/server/rate-limit";
import { hasActivePlan } from "@/lib/server/usage-limits";
import {
  authorizationRedirect,
  issueAuthorizationCode,
  MCP_SCOPES,
  oauthIssuer,
  readJsonObject,
  validateAuthorizationRequest,
  type McpScope,
} from "@/lib/server/mcp/oauth";

const AUTHORIZE_PARAMS = ["response_type", "client_id", "redirect_uri", "scope", "state", "code_challenge", "code_challenge_method", "resource"];

const json = (body: object, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Session + paid plan (owners always pass). Returns the session or the error response. */
async function gate(request: Request) {
  try {
    const session = await getCurrentUser(request);
    if (!session) return json({ error: "login_required" }, 401);
    if (rateLimited(`oauth-authorize:${session.user.id}`, 30, 60_000)) return json({ error: "rate_limited" }, 429);
    if (session.user.role !== "owner" && !(await hasActivePlan(session.user.id))) {
      return withRefreshedSession(json({ error: "plan_required" }, 402), session.token);
    }
    return session;
  } catch {
    return json({ error: "unavailable" }, 503);
  }
}

export async function GET(request: Request) {
  const session = await gate(request);
  if (session instanceof Response) return session;
  const issuer = oauthIssuer(request);
  const result = await validateAuthorizationRequest(new URL(request.url).searchParams, issuer);
  if (!result.ok) return withRefreshedSession(json({ error: "invalid_request", detail: result.detail }, 400), session.token);
  const { client, redirectUri, scopes } = result.value;
  return withRefreshedSession(
    json({ clientName: client.clientName, clientUri: client.clientUri, redirectHost: new URL(redirectUri).host, scopes }),
    session.token,
  );
}

export async function POST(request: Request) {
  // CSRF: JSON-only (forces a CORS preflight cross-site) and an exact same-origin Origin header.
  const origin = request.headers.get("origin");
  if (!origin || (origin !== oauthIssuer(request) && origin !== new URL(request.url).origin)) return json({ error: "forbidden" }, 403);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return json({ error: "unsupported_media_type" }, 415);
  const session = await gate(request);
  if (session instanceof Response) return session;

  const body = await readJsonObject(request);
  const reply = (payload: object, status = 200) => withRefreshedSession(json(payload, status), session.token);
  if (!body || (body.decision !== "allow" && body.decision !== "deny")) return reply({ error: "invalid_request", detail: "decision" }, 400);
  const params = new URLSearchParams();
  for (const name of AUTHORIZE_PARAMS) if (typeof body[name] === "string") params.set(name, body[name]);

  const issuer = oauthIssuer(request);
  const result = await validateAuthorizationRequest(params, issuer);
  if (!result.ok) return reply({ error: "invalid_request", detail: result.detail }, 400);
  if (body.decision === "deny") return reply({ redirectTo: authorizationRedirect(result.value, issuer, { error: "access_denied" }) });

  const chosen = Array.isArray(body.scopes) ? body.scopes : [];
  const scopes = MCP_SCOPES.filter((scope): scope is McpScope => result.value.scopes.includes(scope) && chosen.includes(scope));
  if (scopes.length === 0) return reply({ error: "invalid_request", detail: "scopes" }, 400);
  const code = issueAuthorizationCode({ userId: session.user.id, request: result.value, scopes });
  return reply({ redirectTo: authorizationRedirect(result.value, issuer, { code }) });
}
