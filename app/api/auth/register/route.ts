import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { checkBotId } from "botid/server";
import { disposableEmailBlocklistSet } from "disposable-email-domains-js";
import { isValidPhoneNumber, parsePhoneNumberFromString } from "libphonenumber-js/min";
import { clientIp, rateLimited } from "@/lib/server/rate-limit";
import { verifyTurnstile } from "@/lib/server/turnstile";
import { errorTranslator, localeFrom } from "@/lib/server/locale";
import { sendStaffAlert, sendVerificationEmail, updateEmailUser } from "@/lib/server/email";
import { PocketBaseAuthError, PocketBaseRequestError, isPocketBaseConfigured, pocketBaseFetch } from "@/lib/server/pocketbase";
import { EXPLORE_TOKEN_COOKIE } from "@/lib/explore/types";
import { claimRun } from "@/lib/server/explore/store";

const signupCredits = 50;
const REGISTER_RATE = { max: 5, windowMs: 10 * 60_000 } as const;
// Built once per instance; the package's own helper rebuilds this Set on every call.
const disposableDomains = disposableEmailBlocklistSet();

/** True when the email domain, or any parent domain above the TLD, is a known disposable provider. */
function isDisposableEmail(email: string) {
  const parts = email.slice(email.lastIndexOf("@") + 1).split(".");
  return parts.slice(0, -1).some((_, index) => disposableDomains.has(parts.slice(index).join(".")));
}

/** BotID verdict. Only runs on Vercel (local/self-hosted builds have no BotID proxy); fails open on service errors. */
async function isBotRequest() {
  if (!process.env.VERCEL) return false;
  try {
    return (await checkBotId()).isBot;
  } catch (error) {
    console.error("Leadta register BotID check failed:", error instanceof Error ? error.message : "unknown error");
    return false;
  }
}

type UserRecord = { id: string; email: string; name?: string; credits?: number; role?: unknown };

/** Campo -> código de validación de PocketBase (p. ej. phone -> validation_not_unique). */
function pocketBaseFieldErrors(detail: string): Record<string, string | undefined> {
  try {
    const data = (JSON.parse(detail) as { data?: Record<string, { code?: string } | undefined> }).data ?? {};
    return Object.fromEntries(Object.entries(data).map(([field, issue]) => [field, issue?.code ?? ""]));
  } catch {
    return {};
  }
}

export async function POST(request: Request) {
  let t = errorTranslator(request);
  if (rateLimited(`register:${clientIp(request)}`, REGISTER_RATE.max, REGISTER_RATE.windowMs)) {
    return NextResponse.json({ error: t("authRateLimited") }, { status: 429 });
  }
  if (await isBotRequest()) {
    return NextResponse.json({ error: t("botDetected") }, { status: 403 });
  }
  let body: { email?: unknown; password?: unknown; passwordConfirm?: unknown; phone?: unknown; name?: unknown; locale?: unknown; captcha?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: t("registerDataRequired") }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const passwordConfirm = typeof body.passwordConfirm === "string" ? body.passwordConfirm : "";
  const rawPhone = typeof body.phone === "string" ? body.phone : "";
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
  const locale = localeFrom(request, body.locale);
  t = errorTranslator(request, body.locale);

  const captcha = await verifyTurnstile(body.captcha, clientIp(request));
  if (!captcha.ok) {
    return NextResponse.json({ error: t("captchaRequired"), code: "captcha", reason: captcha.reason }, { status: 400 });
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return NextResponse.json({ error: t("invalidEmail") }, { status: 400 });
  }
  if (isDisposableEmail(email)) {
    return NextResponse.json({ error: t("disposableEmail") }, { status: 400 });
  }
  if (!isValidPhoneNumber(rawPhone)) {
    return NextResponse.json({ error: t("invalidPhone") }, { status: 400 });
  }
  const phone = parsePhoneNumberFromString(rawPhone)!.number; // E.164: the unique index compares one canonical form
  if (password.length < 6 || password.length > 128) {
    return NextResponse.json({ error: t("passwordLength") }, { status: 400 });
  }
  if (passwordConfirm !== password) {
    return NextResponse.json({ error: t("passwordMismatch") }, { status: 400 });
  }

  if (!isPocketBaseConfigured()) {
    console.error("Leadta register failed: PocketBase no está configurado (POCKETBASE_URL, POCKETBASE_SUPERUSER_EMAIL/PASSWORD o POCKETBASE_BRIDGE_SECRET).");
    return NextResponse.json({ error: t("accountService") }, { status: 503 });
  }

  try {
    const user = await pocketBaseFetch<UserRecord>("/api/collections/users/records", {
      method: "POST",
      body: JSON.stringify({ email, phone, password, passwordConfirm, name, credits: signupCredits, emailVisibility: false, verified: false }),
    });
    await sendStaffAlert({ kind: "signup", user: { id: user.id, email, name, phone } }).catch((alertError) => {
      console.error("Leadta signup alert failed:", alertError instanceof Error ? alertError.message : "unknown error");
    });
    let verificationSent = false;
    try {
      await sendVerificationEmail(user, locale);
      await updateEmailUser(user.id, { verification_sent_at: new Date().toISOString() });
      verificationSent = true;
    } catch (emailError) {
      console.error("Leadta verification email failed:", emailError instanceof Error ? emailError.message : "unknown error");
    }
    // Corrida anónima de /explorar: sus leads pasan al usuario nuevo. Nunca rompe el registro.
    const exploreToken = (await cookies()).get(EXPLORE_TOKEN_COOKIE)?.value;
    if (exploreToken) {
      await claimRun(exploreToken, user.id).catch((claimError) => {
        console.error("Leadta explore claim failed:", claimError instanceof Error ? claimError.message : "unknown error");
      });
    }
    const response = NextResponse.json({ verificationRequired: true, verificationSent }, { status: 201 });
    if (exploreToken) response.cookies.set(EXPLORE_TOKEN_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
    return response;
  } catch (error) {
    console.error(
      "Leadta register failed:",
      error instanceof PocketBaseAuthError ? `[${error.reason}] ${error.message}` : error instanceof Error ? error.message : "unknown error",
    );
    if (error instanceof PocketBaseRequestError && (error.status === 400 || error.status === 409)) {
      const fields = pocketBaseFieldErrors(error.detail);
      if (fields.phone === "validation_not_unique") {
        return NextResponse.json({ error: t("phoneTaken") }, { status: 409 });
      }
      if (fields.phone !== undefined) return NextResponse.json({ error: t("invalidPhone") }, { status: 400 });
      if (fields.passwordConfirm !== undefined) return NextResponse.json({ error: t("passwordMismatch") }, { status: 400 });
      if (fields.password !== undefined) {
        return NextResponse.json({ error: t("passwordLength") }, { status: 400 });
      }
      return NextResponse.json({ error: t("accountCreateFailed") }, { status: 409 });
    }
    return NextResponse.json({ error: t("accountService") }, { status: 503 });
  }
}
