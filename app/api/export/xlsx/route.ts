import { connection, NextResponse } from "next/server";
import writeExcelFile from "write-excel-file/node";
import type { SheetData } from "write-excel-file/node";
import { getCurrentUser, withRefreshedSession } from "@/lib/server/auth";
import { isPocketBaseConfigured } from "@/lib/server/pocketbase";
import { uiError } from "@/lib/server/public-error";
import { errorTranslator } from "@/lib/server/locale";
import { loadExportTable } from "@/lib/server/export-rows";

export async function GET(request: Request) {
  const t = errorTranslator(request);
  await connection();
  let session: Awaited<ReturnType<typeof getCurrentUser>>;
  try {
    session = await getCurrentUser(request);
  } catch {
    return NextResponse.json({ error: t("accountService") }, { status: 503 });
  }
  if (!session) return NextResponse.json({ error: t("signInToDownload") }, { status: 401 });
  if (!isPocketBaseConfigured()) {
    return NextResponse.json({ error: uiError(t("pocketbaseNotConfigured"), t("generic")) }, { status: 503 });
  }

  const batchId = new URL(request.url).searchParams.get("batchId");
  if (!batchId || !/^[a-zA-Z0-9]{15}$/.test(batchId)) {
    return NextResponse.json({ error: t("selectValidBatch") }, { status: 400 });
  }

  try {
    const table = await loadExportTable(request, session.user.id, batchId);
    if (!table) return NextResponse.json({ error: t("batchNotFound") }, { status: 404 });
    const { columns, rows } = table;
    const sheetData: SheetData = [
      columns.map((column) => ({ value: column.label, fontWeight: "bold" as const })),
      ...rows,
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
    return NextResponse.json({ error: t("xlsxFailed") }, { status: 503 });
  }
}
