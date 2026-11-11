import { NextResponse } from "next/server";
import { isValidPhoneNumber } from "libphonenumber-js/min";
import { errorTranslator, localeFrom } from "@/lib/server/locale";
import { sendVerificationEmail, updateEmailUser } from "@/lib/server/email";
import { PocketBaseAuthError, PocketBaseRequestError, isPocketBaseConfigured, pocketBaseFetch } from "@/lib/server/pocketbase";

const signupCredits = 25;

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
  let body: { email?: unknown; password?: unknown; passwordConfirm?: unknown; phone?: unknown; name?: unknown; locale?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: t("registerDataRequired") }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const passwordConfirm = typeof body.passwordConfirm === "string" ? body.passwordConfirm : "";
  const phone = typeof body.phone === "string" ? body.phone : "";
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
  const locale = localeFrom(request, body.locale);
  t = errorTranslator(request, body.locale);

  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return NextResponse.json({ error: t("invalidEmail") }, { status: 400 });
  }
  if (!isValidPhoneNumber(phone)) {
    return NextResponse.json({ error: t("invalidPhone") }, { status: 400 });
  }
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
    let verificationSent = false;
    try {
      await sendVerificationEmail(user, locale);
      await updateEmailUser(user.id, { verification_sent_at: new Date().toISOString() });
      verificationSent = true;
    } catch (emailError) {
      console.error("Leadta verification email failed:", emailError instanceof Error ? emailError.message : "unknown error");
    }
    return NextResponse.json({ verificationRequired: true, verificationSent }, { status: 201 });
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
