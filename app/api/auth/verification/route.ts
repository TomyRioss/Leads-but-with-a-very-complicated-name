import { NextResponse } from "next/server";
import { findEmailUser, sendVerificationEmail, updateEmailUser } from "@/lib/server/email";
import { PocketBaseRequestError } from "@/lib/server/pocketbase";

export async function POST(request: Request) {
  let body: { email?: unknown; locale?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ingresá un email válido." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const locale = body.locale === "en" ? "en" : "es";
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) {
    return NextResponse.json({ error: "Ingresá un email válido." }, { status: 400 });
  }

  try {
    const user = await findEmailUser(email);
    if (user && !user.verified) {
      const lastSent = Date.parse(user.verification_sent_at || "");
      const cooldownRemaining = Number.isFinite(lastSent) ? 60_000 - (Date.now() - lastSent) : 0;
      if (cooldownRemaining <= 0) {
        await updateEmailUser(user.id, { verification_sent_at: new Date().toISOString() });
        await sendVerificationEmail(user, locale);
      }
    }
  } catch (error) {
    if (!(error instanceof PocketBaseRequestError && error.status === 404)) {
      console.error("Leadta verification resend failed:", error instanceof Error ? error.message : "unknown error");
    }
  }

  return NextResponse.json({ sent: true }, { status: 202 });
}
