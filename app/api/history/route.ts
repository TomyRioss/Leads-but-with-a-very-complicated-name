import { connection, NextResponse } from "next/server";
import { getCurrentUser, withRefreshedSession } from "@/lib/server/auth";
import { isPocketBaseConfigured, pocketBaseFetch } from "@/lib/server/pocketbase";
import type { Lead } from "@/lib/types";

const perPage = 100;

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

  const page = Number(new URL(request.url).searchParams.get("page") || 1);
  if (!Number.isInteger(page) || page < 1 || page > 100_000) {
    return NextResponse.json({ error: "La página solicitada no es válida." }, { status: 400 });
  }

  try {
    const filter = encodeURIComponent(`batch.user = "${session.user.id}"`);
    const response = await pocketBaseFetch<{
      items: Lead[];
      page: number;
      perPage: number;
      totalItems: number;
      totalPages: number;
    }>(
      `/api/collections/leads/records?page=${page}&perPage=${perPage}&sort=-created_at&filter=${filter}`,
    );
    return withRefreshedSession(NextResponse.json({
      leads: response.items,
      page: response.page,
      perPage: response.perPage,
      totalItems: response.totalItems,
      totalPages: response.totalPages,
    }), session.token);
  } catch (error) {
    console.error("PocketBase unified history failed:", error);
    return NextResponse.json({ error: "No se pudo cargar el historial de leads." }, { status: 503 });
  }
}
