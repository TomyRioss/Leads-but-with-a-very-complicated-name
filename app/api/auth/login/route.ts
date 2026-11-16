import { NextResponse } from "next/server";
import { checkBotId } from "botid/server";
import { setSessionCookie, toUserRole } from "@/lib/server/auth";
import { PocketBaseRequestError, pocketBasePublicFetch } from "@/lib/server/pocketbase";
import { errorTranslator } from "@/lib/server/locale";
import { clientIp, rateLimited } from "@/lib/server/rate-limit";
import { verifyTurnstile } from "@/lib/server/turnstile";

const LOGIN_RATE = { max: 10, windowMs: 10 * 60_000 } as const;

/** BotID verdict. Only runs on Vercel (local/self-hosted builds have no BotID proxy); fails open on service errors. */
async function isBotRequest() {
  if (!process.env.VERCEL) return false;
  try {
    return (await checkBotId()).isBot;
  } catch (error) {
    console.error("Leadta login BotID check failed:", error instanceof Error ? error.message : "unknown error");
    return false;
  }
}

type AuthResponse = { token: string; record: { id: string; email: string; name?: string; credits?: number; role?: unknown; verified?: boolean } };

export async function POST(request: Request) {
  const t = errorTranslator(request);
  if (rateLimited(`login:${clientIp(request)}`, LOGIN_RATE.max, LOGIN_RATE.windowMs)) {
    return NextResponse.json({ error: t("authRateLimited") }, { status: 429 });
  }
  if (await isBotRequest()) {
    return NextResponse.json({ error: t("botDetected") }, { status: 403 });
  }
  let body: { email?: unknown; password?: unknown; captcha?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: t("loginInvalidInput") }, { status: 400 });
  }
  const captcha = await verifyTurnstile(body.captcha, clientIp(request));
  if (!captcha.ok) {
    return NextResponse.json({ error: t("captchaRequired"), code: "captcha", reason: captcha.reason }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!/^\S+@\S+\.\S+$/.test(email) || !password || password.length > 128) {
    return NextResponse.json({ error: t("loginInvalidInput") }, { status: 400 });
  }

  try {
    const auth = await pocketBasePublicFetch<AuthResponse>("/api/collections/users/auth-with-password", {
      method: "POST",
      body: JSON.stringify({ identity: email, password }),
    });
    if (auth.record.verified !== true) {
      return NextResponse.json({ code: "EMAIL_NOT_VERIFIED", error: t("emailNotVerified") }, { status: 403 });
    }
    const response = NextResponse.json({ user: { id: auth.record.id, email: auth.record.email, name: auth.record.name || "", credits: auth.record.credits ?? 0, role: toUserRole(auth.record.role) } });
    setSessionCookie(response, auth.token);
    return response;
  } catch (error) {
    if (error instanceof PocketBaseRequestError && [400, 401, 403].includes(error.status)) {
      return NextResponse.json({ error: t("wrongCredentials") }, { status: 401 });
    }
    return NextResponse.json({ error: t("accountService") }, { status: 503 });
  }
}
