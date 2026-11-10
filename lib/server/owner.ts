import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server/auth";

export type OwnerIdentity = { id: string; email: string };

/** Resolves the owner behind the request, or the 401/403/503 response to return. */
export async function getOwnerSession(request: Request): Promise<{ owner: OwnerIdentity } | { response: NextResponse }> {
  let session;
  try {
    session = await getCurrentUser(request);
  } catch {
    return { response: NextResponse.json({ error: "No se pudo conectar con el servicio de cuentas." }, { status: 503 }) };
  }
  if (!session) return { response: NextResponse.json({ error: "Iniciá sesión para continuar." }, { status: 401 }) };
  if (session.user.role !== "owner") return { response: NextResponse.json({ error: "Acceso restringido al owner." }, { status: 403 }) };
  return { owner: { id: session.user.id, email: session.user.email } };
}

/** Returns null when the request has a PocketBase session of a user with role "owner"; otherwise a 401/403 response. */
export async function requireOwner(request: Request) {
  const session = await getOwnerSession(request);
  return "response" in session ? session.response : null;
}
