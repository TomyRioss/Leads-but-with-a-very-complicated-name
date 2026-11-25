import "server-only";
import { NextResponse } from "next/server";
import { getCurrentUser, withRefreshedSession, type AppUser } from "@/lib/server/auth";
import { isPocketBaseConfigured } from "@/lib/server/pocketbase";

// Sesión + errores comunes de las rutas de workspace (mismo patrón que lead-suite/chat/draft-send).
const MAX_BODY = 20_000;

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** 401 sin sesión (incluye prueba vencida), 503 si la cuenta no responde; si no, corre `handler` y refresca la sesión. */
export async function withUser(request: Request, label: string, handler: (user: AppUser) => Promise<NextResponse>): Promise<NextResponse> {
  let session: Awaited<ReturnType<typeof getCurrentUser>>;
  try {
    session = await getCurrentUser(request);
  } catch {
    return json({ error: "account_unavailable" }, 503);
  }
  if (!session) return json({ error: "unauthorized" }, 401);
  if (!isPocketBaseConfigured()) return json({ error: "account_unavailable" }, 503);
  try {
    return withRefreshedSession(await handler(session.user), session.token);
  } catch (error) {
    console.error(`Workspace ${label} failed`, error instanceof Error ? error.message : "unknown");
    return json({ error: "workspace_unavailable" }, 503);
  }
}

/** Body JSON acotado; undefined si falta o es inválido. Vacío = {}. */
export async function readJson(request: Request): Promise<unknown> {
  const raw = await request.text().catch(() => "");
  if (raw.length > MAX_BODY) return undefined;
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
