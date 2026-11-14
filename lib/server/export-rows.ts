import { pocketBaseFetch } from "@/lib/server/pocketbase";
import type { Lead } from "@/lib/types";
import { getLeadColumnValue, getLeadColumns, type LeadColumnKey } from "@/lib/types";
import { getTranslator, resolveLocale } from "@/lib/server/locale";

export type ExportTable = { columns: { key: LeadColumnKey; label: string }[]; rows: string[][] };

/**
 * Columns and rows of a batch export (shared by the XLSX and CSV routes so both always match).
 * Returns null when the batch doesn't exist or isn't the user's.
 */
export async function loadExportTable(request: Request, userId: string, batchId: string): Promise<ExportTable | null> {
  const ownedFilter = encodeURIComponent(`id = "${batchId}" && user = "${userId}"`);
  const ownedBatch = await pocketBaseFetch<{ items: { id: string }[] }>(
    `/api/collections/lead_batches/records?perPage=1&filter=${ownedFilter}`,
  );
  if (!ownedBatch.items.length) return null;

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
  const columns = getLeadColumns(result.items, [], true, columnLabel);
  const rows = result.items.map((lead) => columns.map((column) => getLeadColumnValue(lead, column.key, columnT("ownerResponse"))));
  return { columns, rows };
}

/**
 * RFC 4180 CSV with a UTF-8 BOM so spreadsheet apps keep accents. Cells a spreadsheet would run as a formula
 * (= @ tab CR, or + / - not followed by a plain phone number) get a leading apostrophe.
 */
export function toCsv(table: ExportTable) {
  const cell = (value: string) => {
    let text = value ?? "";
    if (/^[=@\t\r]/.test(text) || /^[+-](?![\d\s().-]+$)/.test(text)) text = `'${text}`;
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [table.columns.map((column) => cell(column.label)), ...table.rows.map((row) => row.map(cell))].map((line) => line.join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}
