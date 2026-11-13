import { NextRequest, NextResponse } from "next/server";
import { rewardReferral } from "@/lib/server/referrals";
import { getEmailUser, readEmailVerificationToken, sendWelcomeEmail, updateEmailUser } from "@/lib/server/email";

type Result = "verified" | "invalid" | "failed";

function respond(request: NextRequest, locale: "es" | "en", result: Result, json: boolean) {
  if (json) return NextResponse.json({ result });
  const url = new URL(locale === "en" ? "/en/verificar" : "/verificar", request.url);
  url.searchParams.set("emailVerification", result);
  return NextResponse.redirect(url, { status: 303 });
}

export async function POST(request: NextRequest) {
  const json = request.headers.get("content-type")?.includes("application/json") ?? false;
  let rawLocale: unknown;
  let token: unknown;
  try {
    if (json) {
      ({ locale: rawLocale, token } = (await request.json()) as { locale?: unknown; token?: unknown });
    } else {
      const form = await request.formData();
      rawLocale = form.get("locale");
      token = form.get("token");
    }
  } catch {
    return respond(request, "es", "invalid", json);
  }

  const locale = rawLocale === "en" ? "en" : "es";
  if (typeof token !== "string") return respond(request, locale, "invalid", json);
  let claims: ReturnType<typeof readEmailVerificationToken>;
  try {
    claims = readEmailVerificationToken(token);
  } catch {
    return respond(request, locale, "failed", json);
  }
  if (!claims || claims.locale !== locale) return respond(request, locale, "invalid", json);

  try {
    const user = await getEmailUser(claims.id);
    if (user.email.toLowerCase() !== claims.email) return respond(request, locale, "invalid", json);

    if (!user.welcome_email_sent_at) {
      await sendWelcomeEmail(user, locale);
      await updateEmailUser(user.id, {
        verified: true,
        verification_sent_at: "",
        welcome_email_sent_at: new Date().toISOString(),
      });
    } else if (!user.verified) {
      await updateEmailUser(user.id, { verified: true, verification_sent_at: "" });
    }

    // Idempotent and never blocks verification: only a pending referral of this user pays out.
    await rewardReferral(user.id).catch((error) => console.error("Leadta referral reward failed:", error instanceof Error ? error.message : "unknown error"));

    return respond(request, locale, "verified", json);
  } catch (error) {
    console.error("Leadta email verification failed:", error instanceof Error ? error.message : "unknown error");
    return respond(request, locale, "failed", json);
  }
}
