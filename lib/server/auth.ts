import { NextResponse } from "next/server";
import { PocketBaseRequestError, pocketBasePublicFetch } from "@/lib/server/pocketbase";

const sessionCookieName = "leadta_session";
const sessionDurationSeconds = 60 * 60 * 24 * 30;

export type AppUser = { id: string; email: string; name: string };
type PocketBaseAuthResponse = { token: string; record: { id: string; email: string; name?: string } };

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
  response.cookies.set(sessionCookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: sessionDurationSeconds,
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

export async function getCurrentUser(request: Request) {
  const token = getCookie(request, sessionCookieName);
  if (!token) return null;

  try {
    const auth = await pocketBasePublicFetch<PocketBaseAuthResponse>(
      "/api/collections/users/auth-refresh",
      { method: "POST", headers: { Authorization: token }, body: "{}" },
    );
    return {
      token: auth.token,
      user: { id: auth.record.id, email: auth.record.email, name: auth.record.name || "" } satisfies AppUser,
    };
  } catch (error) {
    if (error instanceof PocketBaseRequestError && [400, 401, 403].includes(error.status)) return null;
    throw error;
  }
}

export function withRefreshedSession(response: NextResponse, token: string) {
  setSessionCookie(response, token);
  return response;
}
