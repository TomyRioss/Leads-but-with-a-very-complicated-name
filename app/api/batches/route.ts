import { connection, NextResponse } from "next/server";
import { getCurrentUser, withRefreshedSession } from "@/lib/server/auth";
import { isPocketBaseConfigured, pocketBaseFetch } from "@/lib/server/pocketbase";
import type { LeadBatch } from "@/lib/types";

const defaultPerPage = 20;

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

  const query = new URL(request.url).searchParams;
  const page = Number(query.get("page") || 1);
  const perPage = Number(query.get("perPage") || defaultPerPage);
  if (!Number.isInteger(page) || page < 1 || page > 100_000 || !Number.isInteger(perPage) || perPage < 1 || perPage > 100) {
    return NextResponse.json({ error: "La página solicitada no es válida." }, { status: 400 });
  }

  try {
    const filter = encodeURIComponent(`user = "${session.user.id}"`);
    const response = await pocketBaseFetch<{
      items: LeadBatch[];
      page: number;
      perPage: number;
      totalItems: number;
      totalPages: number;
    }>(
      `/api/collections/lead_batches/records?page=${page}&perPage=${perPage}&sort=-created_at&filter=${filter}`,
    );
    return withRefreshedSession(NextResponse.json({
      batches: response.items,
      page: response.page,
      perPage: response.perPage,
      totalItems: response.totalItems,
      totalPages: response.totalPages,
    }), session.token);
  } catch (error) {
    console.error("PocketBase batch list failed:", error);
    return NextResponse.json({ error: "No se pudo cargar el historial de lotes." }, { status: 503 });
  }
}
