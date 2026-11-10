import { NextResponse } from "next/server";
import { isValidPhoneNumber } from "libphonenumber-js/min";
import { setSessionCookie, toUserRole } from "@/lib/server/auth";
import { PocketBaseRequestError, pocketBasePublicFetch } from "@/lib/server/pocketbase";

const signupCredits = 25;

type AuthResponse = { token: string; record: { id: string; email: string; name?: string; credits?: number; role?: unknown } };

export async function POST(request: Request) {
  let body: { email?: unknown; password?: unknown; passwordConfirm?: unknown; phone?: unknown; name?: unknown };
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
    await pocketBasePublicFetch("/api/collections/users/records", {
      method: "POST",
      body: JSON.stringify({ email, phone, password, passwordConfirm, name, credits: signupCredits, emailVisibility: false }),
    });
    const auth = await pocketBasePublicFetch<AuthResponse>("/api/collections/users/auth-with-password", {
      method: "POST",
      body: JSON.stringify({ identity: email, password }),
    });
    const response = NextResponse.json({ user: { id: auth.record.id, email: auth.record.email, name: auth.record.name || "", credits: auth.record.credits ?? signupCredits, role: toUserRole(auth.record.role) } }, { status: 201 });
    setSessionCookie(response, auth.token);
    return response;
  } catch (error) {
    if (error instanceof PocketBaseRequestError && error.status === 400) {
      return NextResponse.json({ error: "No se pudo crear la cuenta. Revisá si el email ya está registrado." }, { status: 409 });
    }
    return NextResponse.json({ error: "No se pudo conectar con el servicio de cuentas." }, { status: 503 });
  }
}
