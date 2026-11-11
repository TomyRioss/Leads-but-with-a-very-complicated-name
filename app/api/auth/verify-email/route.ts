import { NextRequest, NextResponse } from "next/server";
import { getEmailUser, readEmailVerificationToken, sendWelcomeEmail, updateEmailUser } from "@/lib/server/email";

function redirectToResult(request: NextRequest, locale: "es" | "en", result: "verified" | "invalid" | "failed") {
  const path = locale === "en" ? "/en/buscar" : "/buscar";
  const url = new URL(path, request.url);
  url.searchParams.set("emailVerification", result);
  return NextResponse.redirect(url, { status: 303 });
}

export async function POST(request: NextRequest) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return redirectToResult(request, "es", "invalid");
  }

  const locale = form.get("locale") === "en" ? "en" : "es";
  const token = form.get("token");
  if (typeof token !== "string") return redirectToResult(request, locale, "invalid");
  let claims: ReturnType<typeof readEmailVerificationToken>;
  try {
    claims = readEmailVerificationToken(token);
  } catch {
    return redirectToResult(request, locale, "failed");
  }
  if (!claims || claims.locale !== locale) return redirectToResult(request, locale, "invalid");

  try {
    const user = await getEmailUser(claims.id);
    if (user.email.toLowerCase() !== claims.email) return redirectToResult(request, locale, "invalid");

    if (!user.welcome_email_sent_at) {
      await sendWelcomeEmail(user);
      await updateEmailUser(user.id, {
        verified: true,
        verification_sent_at: "",
        welcome_email_sent_at: new Date().toISOString(),
      });
    } else if (!user.verified) {
      await updateEmailUser(user.id, { verified: true, verification_sent_at: "" });
    }

    return redirectToResult(request, locale, "verified");
  } catch (error) {
    console.error("Leadta email verification failed:", error instanceof Error ? error.message : "unknown error");
    return redirectToResult(request, locale, "failed");
  }
}
