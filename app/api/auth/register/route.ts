import { NextResponse } from "next/server";
import { isValidPhoneNumber } from "libphonenumber-js/min";
import { sendVerificationEmail, updateEmailUser } from "@/lib/server/email";
import { PocketBaseRequestError, pocketBaseFetch } from "@/lib/server/pocketbase";

const signupCredits = 25;

type UserRecord = { id: string; email: string; name?: string; credits?: number; role?: unknown };

export async function POST(request: Request) {
  let body: { email?: unknown; password?: unknown; passwordConfirm?: unknown; phone?: unknown; name?: unknown; locale?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ingresá los datos requeridos para crear la cuenta." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const passwordConfirm = typeof body.passwordConfirm === "string" ? body.passwordConfirm : "";
  const phone = typeof body.phone === "string" ? body.phone : "";
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
  const locale = body.locale === "en" ? "en" : "es";

  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return NextResponse.json({ error: "Ingresá un email válido." }, { status: 400 });
  }
  if (!isValidPhoneNumber(phone)) {
    return NextResponse.json({ error: "Ingresá un número de teléfono válido." }, { status: 400 });
  }
  if (password.length < 6 || password.length > 128) {
    return NextResponse.json({ error: "La contraseña debe tener entre 6 y 128 caracteres." }, { status: 400 });
  }
  if (passwordConfirm !== password) {
    return NextResponse.json({ error: "Las contraseñas no coinciden." }, { status: 400 });
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
    if (error instanceof PocketBaseRequestError && error.status === 400) {
      return NextResponse.json({ error: "No se pudo crear la cuenta. Revisá si el email ya está registrado." }, { status: 409 });
    }
    return NextResponse.json({ error: "No se pudo conectar con el servicio de cuentas." }, { status: 503 });
  }
}
