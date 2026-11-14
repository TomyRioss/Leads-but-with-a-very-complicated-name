import { connection, NextResponse } from "next/server";
import { getCurrentUser, withRefreshedSession } from "@/lib/server/auth";
import { isPocketBaseConfigured } from "@/lib/server/pocketbase";
import { uiError } from "@/lib/server/public-error";
import { errorTranslator } from "@/lib/server/locale";
import { loadExportTable, toCsv } from "@/lib/server/export-rows";

/** Same columns, auth and ownership check as /api/export/xlsx, as CSV. */
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
    return withRefreshedSession(new NextResponse(toCsv(table), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="leadta-${batchId}.csv"`,
        "Cache-Control": "private, no-store",
      },
    }), session.token);
  } catch (error) {
    console.error("CSV export failed:", error);
    return NextResponse.json({ error: t("generic") }, { status: 503 });
  }
}
