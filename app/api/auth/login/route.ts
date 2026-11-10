import { NextResponse } from "next/server";
import { setSessionCookie, toUserRole } from "@/lib/server/auth";
import { PocketBaseRequestError, pocketBasePublicFetch } from "@/lib/server/pocketbase";

type AuthResponse = { token: string; record: { id: string; email: string; name?: string; credits?: number; role?: unknown } };

export async function POST(request: Request) {
  let body: { email?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ingresá un email y una contraseña válidos." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!/^\S+@\S+\.\S+$/.test(email) || !password || password.length > 128) {
    return NextResponse.json({ error: "Ingresá un email y una contraseña válidos." }, { status: 400 });
  }

  try {
    const auth = await pocketBasePublicFetch<AuthResponse>("/api/collections/users/auth-with-password", {
      method: "POST",
      body: JSON.stringify({ identity: email, password }),
    });
    const response = NextResponse.json({ user: { id: auth.record.id, email: auth.record.email, name: auth.record.name || "", credits: auth.record.credits ?? 0, role: toUserRole(auth.record.role) } });
    setSessionCookie(response, auth.token);
    return response;
  } catch (error) {
    if (error instanceof PocketBaseRequestError && [400, 401].includes(error.status)) {
      return NextResponse.json({ error: "Email o contraseña incorrectos." }, { status: 401 });
    }
    return NextResponse.json({ error: "No se pudo conectar con el servicio de cuentas." }, { status: 503 });
  }
}
