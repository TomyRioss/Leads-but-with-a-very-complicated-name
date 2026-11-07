import { NextResponse } from "next/server";
import { setSessionCookie } from "@/lib/server/auth";
import { PocketBaseRequestError, pocketBasePublicFetch } from "@/lib/server/pocketbase";

type AuthResponse = { token: string; record: { id: string; email: string; name?: string } };

export async function POST(request: Request) {
  let body: { email?: unknown; password?: unknown; name?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ingresá un email y una contraseña válidos." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
  if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 10 || password.length > 128) {
    return NextResponse.json({ error: "Usá un email válido y una contraseña de 10 a 128 caracteres." }, { status: 400 });
  }

  try {
    await pocketBasePublicFetch("/api/collections/users/records", {
      method: "POST",
      body: JSON.stringify({ email, password, passwordConfirm: password, name, emailVisibility: false }),
    });
    const auth = await pocketBasePublicFetch<AuthResponse>("/api/collections/users/auth-with-password", {
      method: "POST",
      body: JSON.stringify({ identity: email, password }),
    });
    const response = NextResponse.json({ user: { id: auth.record.id, email: auth.record.email, name: auth.record.name || "" } }, { status: 201 });
    setSessionCookie(response, auth.token);
    return response;
  } catch (error) {
    if (error instanceof PocketBaseRequestError && error.status === 400) {
      return NextResponse.json({ error: "No se pudo crear la cuenta. Revisá si el email ya está registrado." }, { status: 409 });
    }
    return NextResponse.json({ error: "No se pudo conectar con el servicio de cuentas." }, { status: 503 });
  }
}
