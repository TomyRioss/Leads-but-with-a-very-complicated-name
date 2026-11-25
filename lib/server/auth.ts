import { NextResponse } from "next/server";
import { PocketBaseRequestError, pocketBasePublicFetch } from "@/lib/server/pocketbase";
import { hasActivePlan } from "@/lib/server/usage-limits";
import { trialAccess, trialEndsAt, type TrialAccess } from "@/lib/trial";

const sessionCookieName = "leadta_session";
const sessionDurationSeconds = 60 * 60 * 24 * 30;
const pendingPhoneCookieName = "leadta_google_phone";
const pendingPhoneMaxAgeSeconds = 60 * 15;

export type UserRole = "user" | "owner";
/** access: "expired" = trial over without a paid plan; trialEndsAt "" = no trial end (older account or owner). */
export type AppUser = { id: string; email: string; name: string; credits: number; role: UserRole; access: TrialAccess; trialEndsAt: string };
type PocketBaseAuthResponse = { token: string; record: PocketBaseUserRecord };

/** Only the exact string "owner" grants the owner role; anything else (missing field included) is a regular user. */
export function toUserRole(role: unknown): UserRole {
  return role === "owner" ? "owner" : "user";
}

function getCookie(request: Request, name: string) {
  const cookie = request.headers.get("cookie");
  if (!cookie) return "";
  const value = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  if (!value) return "";
  try {
    return decodeURIComponent(value.slice(name.length + 1));
  } catch {
    return "";
  }
}

export function setSessionCookie(response: NextResponse, token: string) {
  let maxAge = sessionDurationSeconds;
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] || "", "base64url").toString("utf8")) as { exp?: unknown };
    if (typeof payload.exp === "number") {
      maxAge = Math.max(0, Math.min(sessionDurationSeconds, payload.exp - Math.floor(Date.now() / 1000)));
    }
  } catch {
    // Keep the default duration when the token payload isn't readable here.
  }
  response.cookies.set(sessionCookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge,
  });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(sessionCookieName, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

/** Google sign-in without users.phone: the token waits here (no session yet) until the phone is saved. */
export function setPendingPhoneCookie(response: NextResponse, token: string) {
  response.cookies.set(pendingPhoneCookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: pendingPhoneMaxAgeSeconds,
  });
}

export function clearPendingPhoneCookie(response: NextResponse) {
  response.cookies.set(pendingPhoneCookieName, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export function getPendingPhoneUser(request: Request) {
  return getCurrentUser(request, pendingPhoneCookieName);
}

export async function getCurrentUser(request: Request, cookieName = sessionCookieName) {
  const token = getCookie(request, cookieName);
  if (!token) return null;

  try {
    const claims = readAuthTokenClaims(token);
    if (claims?.refreshable === false && typeof claims.id === "string") {
      const record = await pocketBasePublicFetch<PocketBaseUserRecord>(
        `/api/collections/users/records/${encodeURIComponent(claims.id)}`,
        { headers: { Authorization: token } },
      );
      return withTrialGate(request, { token, user: await mapUser(record) });
    }

    const auth = await pocketBasePublicFetch<PocketBaseAuthResponse>(
      "/api/collections/users/auth-refresh",
      { method: "POST", headers: { Authorization: token }, body: "{}" },
    );
    return withTrialGate(request, { token: auth.token, user: await mapUser(auth.record) });
  } catch (error) {
    if (error instanceof PocketBaseRequestError && [400, 401, 403].includes(error.status)) return null;
    throw error;
  }
}

type PocketBaseUserRecord = { id: string; email: string; name?: string; credits?: number; role?: unknown; created?: string };
type AuthTokenClaims = { id?: unknown; refreshable?: unknown };

function readAuthTokenClaims(token: string): AuthTokenClaims | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as AuthTokenClaims;
  } catch {
    return null;
  }
}

// API paths an account with an expired trial still reaches: session, sign-in/out and paying.
const TRIAL_OPEN_API = ["/api/auth/", "/api/subscriptions", "/api/mercadopago"];

/** Expired trial: private APIs see no session (401); the open paths get the user with access "expired". */
function withTrialGate<T extends { user: AppUser }>(request: Request, session: T): T | null {
  if (session.user.access !== "expired") return session;
  const path = new URL(request.url).pathname;
  return TRIAL_OPEN_API.some((prefix) => path.startsWith(prefix)) ? session : null;
}

async function mapUser(record: PocketBaseUserRecord): Promise<AppUser> {
  const role = toUserRole(record.role);
  const endsAt = role === "owner" ? "" : trialEndsAt(record.created);
  // Subscription lookup only once the trial is over: in-trial and older accounts cost no extra query.
  const paid = endsAt && Date.now() >= Date.parse(endsAt) ? await hasActivePlan(record.id) : false;
  return {
    id: record.id,
    email: record.email,
    name: record.name || "",
    credits: typeof record.credits === "number" && record.credits >= 0 ? record.credits : 0,
    role,
    access: trialAccess(endsAt, paid),
    trialEndsAt: endsAt,
  };
}

export function withRefreshedSession(response: NextResponse, token: string) {
  setSessionCookie(response, token);
  return response;
}
