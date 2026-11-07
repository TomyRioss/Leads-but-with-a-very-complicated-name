import { connection, NextResponse } from "next/server";
import { getCurrentUser, withRefreshedSession } from "@/lib/server/auth";
import { isPocketBaseConfigured, pocketBaseFetch } from "@/lib/server/pocketbase";
import type { Lead } from "@/lib/types";

export async function GET(request: Request) {
  await connection();
  let session: Awaited<ReturnType<typeof getCurrentUser>>;
  try {
    session = await getCurrentUser(request);
  } catch {
    return NextResponse.json({ error: "No se pudo conectar con el servicio de cuentas." }, { status: 503 });
  }
  if (!session) return NextResponse.json({ error: "Iniciá sesión para ver estos leads." }, { status: 401 });
  if (!isPocketBaseConfigured()) {
    return NextResponse.json({ error: "PocketBase todavía no está configurado." }, { status: 503 });
  }

  const batchId = new URL(request.url).searchParams.get("batchId");
  if (!batchId || !/^[a-zA-Z0-9]{15}$/.test(batchId)) {
    return NextResponse.json({ error: "Seleccioná un lote válido." }, { status: 400 });
  }

  try {
    const batchFilter = encodeURIComponent(`id = "${batchId}" && user = "${session.user.id}"`);
    const ownedBatch = await pocketBaseFetch<{ items: { id: string }[] }>(
      `/api/collections/lead_batches/records?perPage=1&filter=${batchFilter}`,
    );
    if (!ownedBatch.items.length) return NextResponse.json({ error: "No se encontró ese lote en tu historial." }, { status: 404 });

    const filter = encodeURIComponent(`batch = "${batchId}"`);
    const response = await pocketBaseFetch<{ items: Lead[] }>(
      `/api/collections/leads/records?perPage=100&sort=created_at&filter=${filter}`,
    );
    return withRefreshedSession(NextResponse.json({ leads: response.items }), session.token);
  } catch (error) {
    console.error("PocketBase lead list failed:", error);
    return NextResponse.json({ error: "No se pudieron cargar los resultados." }, { status: 503 });
  }
}
