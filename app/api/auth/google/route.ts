import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

const stateCookie = "leadta_google_state";
const verifierCookie = "leadta_google_verifier";
const localeCookie = "leadta_google_locale";
const oauthCookieMaxAge = 600;

function appOrigin() {
  const configured = process.env.APP_URL?.trim() || (process.env.VERCEL ? "https://leadta.app" : "http://localhost:3000");
  const url = new URL(configured);
  if (url.protocol !== "https:" && url.hostname !== "localhost") throw new Error("APP_URL must use HTTPS.");
  return url.origin;
}

function setOauthCookie(response: NextResponse, name: string, value: string, secure: boolean) {
  response.cookies.set(name, value, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: oauthCookieMaxAge,
  });
}

export async function GET(request: NextRequest) {
  const origin = appOrigin();
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return NextResponse.redirect(new URL("/buscar?authError=google", origin));

  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const locale = request.nextUrl.searchParams.get("locale") === "en" ? "en" : "es";
  const redirectUri = new URL("/api/auth/google/callback", origin).toString();
  const authorizeUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorizeUrl.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();

  const response = NextResponse.redirect(authorizeUrl);
  const secure = origin.startsWith("https://");
  setOauthCookie(response, stateCookie, state, secure);
  setOauthCookie(response, verifierCookie, verifier, secure);
  setOauthCookie(response, localeCookie, locale, secure);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
