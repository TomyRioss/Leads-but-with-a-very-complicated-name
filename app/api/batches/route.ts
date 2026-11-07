import { connection, NextResponse } from "next/server";
import { getCurrentUser, withRefreshedSession } from "@/lib/server/auth";
import { isPocketBaseConfigured, pocketBaseFetch } from "@/lib/server/pocketbase";
import type { LeadBatch } from "@/lib/types";

export async function GET(request: Request) {
  await connection();
  let session: Awaited<ReturnType<typeof getCurrentUser>>;
  try {
    session = await getCurrentUser(request);
  } catch {
    return NextResponse.json({ error: "No se pudo conectar con el servicio de cuentas." }, { status: 503 });
  }
  if (!session) return NextResponse.json({ error: "Iniciá sesión para ver tu historial." }, { status: 401 });
  if (!isPocketBaseConfigured()) {
    return NextResponse.json({ error: "PocketBase todavía no está configurado." }, { status: 503 });
  }

  try {
    const filter = encodeURIComponent(`user = "${session.user.id}"`);
    const response = await pocketBaseFetch<{ items: LeadBatch[] }>(
      `/api/collections/lead_batches/records?perPage=20&sort=-created_at&filter=${filter}`,
    );
    return withRefreshedSession(NextResponse.json({ batches: response.items }), session.token);
  } catch (error) {
    console.error("PocketBase batch list failed:", error);
    return NextResponse.json({ error: "No se pudo cargar el historial de lotes." }, { status: 503 });
  }
}
