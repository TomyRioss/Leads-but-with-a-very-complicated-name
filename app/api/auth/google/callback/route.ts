import { randomBytes, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { setSessionCookie, toUserRole } from "@/lib/server/auth";
import { sendWelcomeEmail, updateEmailUser } from "@/lib/server/email";
import { pocketBaseFetch } from "@/lib/server/pocketbase";

const stateCookie = "leadta_google_state";
const verifierCookie = "leadta_google_verifier";
const localeCookie = "leadta_google_locale";
const sessionDurationSeconds = 60 * 60 * 24 * 30;
const signupCredits = 240;

type GoogleProfile = { sub?: unknown; email?: unknown; email_verified?: unknown; name?: unknown };
type PocketBaseUser = { id: string; email: string; name?: string; credits?: number; role?: unknown; verified?: boolean; welcome_email_sent_at?: string };
type PocketBaseList = { items: PocketBaseUser[] };
type PocketBaseAuth = { token: string; record: PocketBaseUser };

function appOrigin() {
  const configured = process.env.APP_URL?.trim() || (process.env.VERCEL ? "https://leadta.app" : "http://localhost:3000");
  const url = new URL(configured);
  if (url.protocol !== "https:" && url.hostname !== "localhost") throw new Error("APP_URL must use HTTPS.");
  return url.origin;
}

function sameState(actual: string, expected: string) {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function clearOauthCookies(response: NextResponse) {
  for (const name of [stateCookie, verifierCookie, localeCookie]) {
    response.cookies.set(name, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  }
}

function errorRedirect(locale: string) {
  const pathname = locale === "en" ? "/en/buscar" : "/buscar";
  const response = NextResponse.redirect(new URL(`${pathname}?authError=google`, appOrigin()));
  clearOauthCookies(response);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET(request: NextRequest) {
  const origin = appOrigin();
  const locale = request.cookies.get(localeCookie)?.value === "en" ? "en" : "es";
  const code = request.nextUrl.searchParams.get("code") || "";
  const state = request.nextUrl.searchParams.get("state") || "";
  const expectedState = request.cookies.get(stateCookie)?.value || "";
  const verifier = request.cookies.get(verifierCookie)?.value || "";
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (request.nextUrl.searchParams.has("error") || !code || !state || !expectedState || !verifier || !sameState(state, expectedState) || !clientId || !clientSecret) {
    return errorRedirect(locale);
  }

  try {
    const redirectUri = new URL("/api/auth/google/callback", origin).toString();
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        code_verifier: verifier,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!tokenResponse.ok) return errorRedirect(locale);
    const tokenPayload = await tokenResponse.json() as { access_token?: unknown };
    if (typeof tokenPayload.access_token !== "string") return errorRedirect(locale);

    const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${tokenPayload.access_token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!profileResponse.ok) return errorRedirect(locale);
    const profile = await profileResponse.json() as GoogleProfile;
    const email = typeof profile.email === "string" ? profile.email.trim().toLowerCase() : "";
    if (profile.email_verified !== true || typeof profile.sub !== "string" || !/^\S+@\S+\.\S+$/.test(email)) {
      return errorRedirect(locale);
    }

    const filter = `email = ${JSON.stringify(email)}`;
    const query = new URLSearchParams({ filter, perPage: "1", fields: "id,email,name,credits,role,verified,welcome_email_sent_at" });
    const result = await pocketBaseFetch<PocketBaseList>(`/api/collections/users/records?${query.toString()}`);
    let user = result.items[0];
    if (!user) {
      const password = randomBytes(48).toString("base64url");
      user = await pocketBaseFetch<PocketBaseUser>("/api/collections/users/records", {
        method: "POST",
        body: JSON.stringify({
          email,
          password,
          passwordConfirm: password,
          name: typeof profile.name === "string" ? profile.name.trim().slice(0, 120) : email.split("@")[0],
          credits: signupCredits,
          emailVisibility: false,
          verified: true,
        }),
      });
    }

    if (!user.verified) {
      user = await pocketBaseFetch<PocketBaseUser>(`/api/collections/users/records/${encodeURIComponent(user.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ verified: true }),
      });
    }

    if (user.verified && !user.welcome_email_sent_at) {
      try {
        await sendWelcomeEmail(user, locale);
        await updateEmailUser(user.id, { welcome_email_sent_at: new Date().toISOString() });
      } catch (error) {
        console.error("Leadta Google welcome email failed:", error instanceof Error ? error.message : "unknown error");
      }
    }

    const auth = await pocketBaseFetch<PocketBaseAuth>(`/api/collections/users/impersonate/${encodeURIComponent(user.id)}`, {
      method: "POST",
      body: JSON.stringify({ duration: sessionDurationSeconds }),
    });
    const isOwner = toUserRole(auth.record.role) === "owner";
    const destination = locale === "en" ? (isOwner ? "/en/owner" : "/en/buscar") : (isOwner ? "/owner" : "/buscar");
    const response = NextResponse.redirect(new URL(destination, origin));
    setSessionCookie(response, auth.token);
    clearOauthCookies(response);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return errorRedirect(locale);
  }
}
