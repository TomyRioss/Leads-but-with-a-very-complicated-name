import { connection, NextResponse } from "next/server";
import writeExcelFile from "write-excel-file/node";
import type { SheetData } from "write-excel-file/node";
import { getCurrentUser, withRefreshedSession } from "@/lib/server/auth";
import { isPocketBaseConfigured, pocketBaseFetch } from "@/lib/server/pocketbase";
import type { Lead } from "@/lib/types";
import { getLeadColumnValue, getLeadColumns } from "@/lib/types";

export async function GET(request: Request) {
  await connection();
  let session: Awaited<ReturnType<typeof getCurrentUser>>;
  try {
    session = await getCurrentUser(request);
  } catch {
    return NextResponse.json({ error: "No se pudo conectar con tu cuenta." }, { status: 503 });
  }
  if (!session) return NextResponse.json({ error: "Iniciá sesión para descargar este lote." }, { status: 401 });
  if (!isPocketBaseConfigured()) {
    return NextResponse.json({ error: "PocketBase todavía no está configurado." }, { status: 503 });
  }

  const batchId = new URL(request.url).searchParams.get("batchId");
  if (!batchId || !/^[a-zA-Z0-9]{15}$/.test(batchId)) {
    return NextResponse.json({ error: "Seleccioná un lote válido." }, { status: 400 });
  }

  try {
    const ownedFilter = encodeURIComponent(`id = "${batchId}" && user = "${session.user.id}"`);
    const ownedBatch = await pocketBaseFetch<{ items: { id: string }[] }>(
      `/api/collections/lead_batches/records?perPage=1&filter=${ownedFilter}`,
    );
    if (!ownedBatch.items.length) return NextResponse.json({ error: "No se encontró ese lote en tu historial." }, { status: 404 });

    const leadsFilter = encodeURIComponent(`batch = "${batchId}"`);
    const result = await pocketBaseFetch<{ items: Lead[] }>(
      `/api/collections/leads/records?perPage=100&sort=created_at&filter=${leadsFilter}`,
    );
    const columns = getLeadColumns(result.items, [], process.env.ENVIROMENT?.trim().toLowerCase() === "dev");
    const sheetData: SheetData = [
      columns.map((column) => ({ value: column.label, fontWeight: "bold" as const })),
      ...result.items.map((lead) => columns.map((column) => {
        return getLeadColumnValue(lead, column.key);
      })),
    ];
    const workbook = await writeExcelFile(sheetData, {
      sheet: "Leads",
      orientation: "landscape",
      stickyRowsCount: 1,
      columns: columns.map((column) => ({
        width: column.key === "name" ? 32 : /^review_[1-5]$/.test(column.key) ? 60 : /^rating_[1-5]$/.test(column.key) ? 12 : 24,
      })),
    }).toBuffer();

    return withRefreshedSession(new NextResponse(new Uint8Array(workbook), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Cache-Control": "private, no-store",
      },
    }), session.token);
  } catch (error) {
    console.error("XLSX export failed:", error);
    return NextResponse.json({ error: "No se pudo generar el archivo XLSX." }, { status: 503 });
  }
}
