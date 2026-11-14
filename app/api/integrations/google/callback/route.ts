import type { NextRequest } from "next/server";
import { saveConnection } from "@/lib/server/google-connections";
import { NONCE_COOKIE, redirectUri, redirectWithFlash, requireUser, safeReturnTo, verifyState } from "../_shared";

type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; id_token?: string };

function finish(path: string, status: "connected" | "error" | "denied") {
  const response = redirectWithFlash(path, status);
  response.cookies.set(NONCE_COOKIE, "", { httpOnly: true, path: "/api/integrations/google", maxAge: 0 });
  return response;
}

/** Payload del id_token recibido directo de Google por TLS en el intercambio (no viene del cliente). */
function idTokenClaims(idToken: string | undefined): { email?: string; sub?: string } {
  try {
    return JSON.parse(Buffer.from(idToken?.split(".")[1] ?? "", "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const user = await requireUser(request);
  if (!user) return finish("/buscar", "error");
  const state = verifyState(params.get("state") ?? "", request.cookies.get(NONCE_COOKIE)?.value ?? "", user.id);
  if (!state) return finish("/integraciones", "error");
  const returnTo = safeReturnTo(state.r);
  if (params.get("error")) return finish(returnTo, "denied");
  const code = params.get("code");
  if (!code) return finish(returnTo, "error");

  try {
    const exchange = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID ?? "",
        client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
        redirect_uri: redirectUri(),
        grant_type: "authorization_code",
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!exchange.ok) {
      console.error("Google Drive token exchange failed", exchange.status); // sin cuerpo: puede traer datos sensibles
      return finish(returnTo, "error");
    }
    const tokens = await exchange.json() as TokenResponse;
    if (!tokens.access_token) return finish(returnTo, "error");
    const claims = idTokenClaims(tokens.id_token);
    await saveConnection(user.id, {
      googleEmail: claims.email ?? "",
      googleSub: claims.sub ?? "",
      scopes: tokens.scope ?? "",
      accessToken: tokens.access_token,
      ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
      accessExpiresAt: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString(),
    });
    return finish(returnTo, "connected");
  } catch (error) {
    console.error("Google Drive connect failed", error instanceof Error ? error.name : "unknown");
    return finish(returnTo, "error");
  }
}
