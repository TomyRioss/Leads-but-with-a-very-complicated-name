import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server/auth";

/** Returns null when the request has a PocketBase session of a user with role "owner"; otherwise a 401/403 response. */
export async function requireOwner(request: Request) {
  let session;
  try {
    session = await getCurrentUser(request);
  } catch {
    return NextResponse.json({ error: "No se pudo conectar con el servicio de cuentas." }, { status: 503 });
  }
  if (!session) return NextResponse.json({ error: "Iniciá sesión para continuar." }, { status: 401 });
  if (session.user.role !== "owner") return NextResponse.json({ error: "Acceso restringido al owner." }, { status: 403 });
  return null;
}
