import { after, NextResponse } from "next/server";
import { findEmailUser, sendPasswordResetEmail } from "@/lib/server/email";
import { errorTranslator, localeFrom } from "@/lib/server/locale";
import { clientIp, rateLimited } from "@/lib/server/rate-limit";

const IP_RATE = { max: 5, windowMs: 10 * 60_000 } as const;

/** Sends a reset link. Always 202 for a valid email so the response never reveals whether an account exists. */
export async function POST(request: Request) {
  let t = errorTranslator(request);
  if (rateLimited(`password-reset:${clientIp(request)}`, IP_RATE.max, IP_RATE.windowMs)) {
    return NextResponse.json({ error: t("authRateLimited") }, { status: 429 });
  }
  let body: { email?: unknown; locale?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: t("invalidEmail") }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const locale = localeFrom(request, body.locale);
  t = errorTranslator(request, body.locale);
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) {
    return NextResponse.json({ error: t("invalidEmail") }, { status: 400 });
  }

  // ponytail: per-instance 60 s cooldown per email; Resend's idempotency key covers retries of the same link.
  if (!rateLimited(`password-reset-email:${email}`, 1, 60_000)) {
    // After the response: same timing whether or not the account exists.
    after(async () => {
      try {
        const user = await findEmailUser(email);
        if (user) await sendPasswordResetEmail(user, locale);
      } catch (error) {
        console.error("Leadta password reset email failed:", error instanceof Error ? error.message : "unknown error");
      }
    });
  }

  return NextResponse.json({ sent: true }, { status: 202 });
}
