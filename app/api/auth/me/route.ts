import { connection, NextResponse } from "next/server";
import { clearSessionCookie, getCurrentUser, withRefreshedSession } from "@/lib/server/auth";

export async function GET(request: Request) {
  await connection();
  try {
    const session = await getCurrentUser(request);
    const response = NextResponse.json({ user: session?.user ?? null });
    if (session) return withRefreshedSession(response, session.token);
    clearSessionCookie(response);
    return response;
  } catch {
    return NextResponse.json({ error: "No se pudo conectar con el servicio de cuentas." }, { status: 503 });
  }
}
