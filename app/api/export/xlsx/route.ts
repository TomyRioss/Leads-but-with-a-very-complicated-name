import { connection, NextResponse } from "next/server";
import writeExcelFile from "write-excel-file/node";
import type { SheetData } from "write-excel-file/node";
import { getCurrentUser, withRefreshedSession } from "@/lib/server/auth";
import { isPocketBaseConfigured, pocketBaseFetch } from "@/lib/server/pocketbase";
import { uiError } from "@/lib/server/public-error";
import type { Lead } from "@/lib/types";
import { getLeadColumnValue, getLeadColumns } from "@/lib/types";
import { errorTranslator, getTranslator, resolveLocale } from "@/lib/server/locale";

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
    const ownedFilter = encodeURIComponent(`id = "${batchId}" && user = "${session.user.id}"`);
    const ownedBatch = await pocketBaseFetch<{ items: { id: string }[] }>(
      `/api/collections/lead_batches/records?perPage=1&filter=${ownedFilter}`,
    );
    if (!ownedBatch.items.length) return NextResponse.json({ error: t("batchNotFound") }, { status: 404 });

    const leadsFilter = encodeURIComponent(`batch = "${batchId}"`);
    const result = await pocketBaseFetch<{ items: Lead[] }>(
      `/api/collections/leads/records?perPage=100&sort=created_at&filter=${leadsFilter}`,
    );
    const columnT = getTranslator(resolveLocale(request), "Search");
    const columnLabel = (key: string, fallback: string) => {
      const match = /^(review|rating)_([1-5])$/.exec(key);
      if (match) return columnT(`columns.${match[1]}`, { number: match[2] });
      return /^(name|maps_url|address|phone|email|review_count|average_rating|website|category|pain_points|enrichment)$/.test(key) ? columnT(`columns.${key}`) : fallback;
    };
    const columns = getLeadColumns(result.items, [], process.env.ENVIROMENT?.trim().toLowerCase() === "dev", columnLabel);
    const sheetData: SheetData = [
      columns.map((column) => ({ value: column.label, fontWeight: "bold" as const })),
      ...result.items.map((lead) => columns.map((column) => {
        return getLeadColumnValue(lead, column.key, columnT("ownerResponse"));
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
    return NextResponse.json({ error: t("xlsxFailed") }, { status: 503 });
  }
}
