// Reads connected Google Drive files as a table (Sheets/CSV) or text (Docs/PDF/MD/TXT). File content is untrusted data.
import { getValidAccessToken, isGoogleDriveFullAccess, listFiles, type GoogleFile } from "@/lib/server/google-connections";
import { parseCsv, sanitizeText, truncateText } from "@/lib/server/leadtita-attachments";

export const GOOGLE_DRIVE_LIMITS = {
  maxRows: 2000,
  maxColumns: 50,
  maxCellChars: 500,
  maxBytes: 10 * 1024 * 1024,
  maxTextChars: 100_000,
  timeoutMs: 20_000,
  searchResults: 20,
} as const;

export type DriveFileContent =
  | { kind: "table"; name: string; rows: string[][]; columns: string[]; totalRows: number; truncated: boolean }
  | { kind: "text"; name: string; text: string; truncated: boolean };

export type GoogleDriveErrorCode = "not_found" | "forbidden" | "unsupported" | "too_large" | "failed";

export class GoogleDriveError extends Error {
  readonly code: GoogleDriveErrorCode;
  constructor(code: GoogleDriveErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "GoogleDriveError";
  }
}

const MIME = {
  sheet: "application/vnd.google-apps.spreadsheet",
  doc: "application/vnd.google-apps.document",
} as const;
const CSV_TYPES = new Set(["text/csv", "application/csv", "text/comma-separated-values"]);
const TEXT_TYPES = new Set(["text/plain", "text/markdown", "text/x-markdown", "text/tab-separated-values"]);

// ---------- Pure helpers ----------

const cell = (value: unknown) => {
  const text = value == null ? "" : typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : "";
  return sanitizeText(text).replace(/\n+/g, " ").slice(0, GOOGLE_DRIVE_LIMITS.maxCellChars);
};

/** First non-empty row = headers (blank/duplicate → "Column N" / "name 2"); data rows padded to the header width and capped. */
export function valuesToTable(values: unknown, limits: { maxRows?: number; maxColumns?: number } = {}) {
  const maxRows = limits.maxRows ?? GOOGLE_DRIVE_LIMITS.maxRows;
  const maxColumns = limits.maxColumns ?? GOOGLE_DRIVE_LIMITS.maxColumns;
  const grid = (Array.isArray(values) ? values : [])
    .map((row) => (Array.isArray(row) ? row.map(cell) : []))
    .filter((row) => row.some((value) => value.trim()));
  if (grid.length === 0) return { columns: [] as string[], rows: [] as string[][], totalRows: 0, truncated: false };

  const [header, ...data] = grid;
  const width = Math.min(maxColumns, Math.max(header.length, ...data.slice(0, maxRows).map((row) => row.length)));
  const seen = new Map<string, number>();
  const columns = Array.from({ length: width }, (_, index) => {
    const base = header[index]?.trim() || `Column ${index + 1}`;
    const count = (seen.get(base.toLowerCase()) ?? 0) + 1;
    seen.set(base.toLowerCase(), count);
    return count > 1 ? `${base} ${count}` : base;
  });
  const rows = data.slice(0, maxRows).map((row) => Array.from({ length: width }, (_, index) => row[index] ?? ""));
  const truncated = data.length > maxRows || header.length > maxColumns || data.some((row) => row.length > maxColumns);
  return { columns, rows, totalRows: data.length, truncated };
}

/** Escapes a value for a Drive `q` string literal ('...' with \ and ' escaped). */
export function driveQueryLiteral(value: string) {
  return `'${value.replace(/[\\']/g, "\\$&")}'`;
}

// ---------- Google REST ----------

async function googleFetch(url: string, token: string): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(GOOGLE_DRIVE_LIMITS.timeoutMs) });
  } catch {
    throw new GoogleDriveError("failed", "Google Drive did not respond in time.");
  }
  if (response.ok) return response;
  if (response.status === 404) throw new GoogleDriveError("not_found", "File not found or not shared with Leadtita.");
  if (response.status === 401 || response.status === 403) throw new GoogleDriveError("forbidden", "No access to this Google file.");
  throw new GoogleDriveError("failed", `Google API responded ${response.status}.`);
}

/** Body bytes, refusing anything over maxBytes (header check first, then actual length). */
async function readBytes(response: Response) {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > GOOGLE_DRIVE_LIMITS.maxBytes) throw new GoogleDriveError("too_large", "File too large.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > GOOGLE_DRIVE_LIMITS.maxBytes) throw new GoogleDriveError("too_large", "File too large.");
  return bytes;
}

const textResult = (name: string, raw: string): DriveFileContent => {
  const { text, truncated } = truncateText(sanitizeText(raw), GOOGLE_DRIVE_LIMITS.maxTextChars);
  return { kind: "text", name, text, truncated };
};

async function pdfText(bytes: Uint8Array) {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const { text } = await extractText(await getDocumentProxy(bytes), { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : text;
}

const DRIVE = "https://www.googleapis.com/drive/v3/files";

export async function readDriveFile(userId: string, fileId: string): Promise<DriveFileContent> {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(fileId)) throw new GoogleDriveError("not_found", "Invalid file id.");
  // With drive.file Google already limits us to Picker-chosen files; we also require the file to be connected here.
  if (!isGoogleDriveFullAccess() && !(await listFiles(userId)).some((file) => file.id === fileId)) {
    throw new GoogleDriveError("not_found", "File is not connected.");
  }
  const token = await getValidAccessToken(userId);
  const id = encodeURIComponent(fileId);
  const meta = (await (await googleFetch(`${DRIVE}/${id}?fields=id,name,mimeType,size&supportsAllDrives=true`, token)).json()) as { name?: string; mimeType?: string; size?: string };
  const name = (meta.name ?? fileId).slice(0, 300);
  const mimeType = meta.mimeType ?? "";
  if (Number(meta.size ?? 0) > GOOGLE_DRIVE_LIMITS.maxBytes) throw new GoogleDriveError("too_large", "File too large.");

  if (mimeType === MIME.sheet) {
    // No sheet name in the range = first visible sheet; one request, bounded by rows/columns.
    const range = encodeURIComponent(`A1:AX${GOOGLE_DRIVE_LIMITS.maxRows + 1}`);
    const payload = (await (await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${range}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`, token)).json()) as { values?: unknown };
    return { kind: "table", name, ...valuesToTable(payload.values) };
  }
  if (mimeType === MIME.doc) {
    const bytes = await readBytes(await googleFetch(`${DRIVE}/${id}/export?mimeType=text%2Fplain`, token));
    return textResult(name, new TextDecoder().decode(bytes));
  }
  const isCsv = CSV_TYPES.has(mimeType) || /\.csv$/i.test(name);
  const isText = TEXT_TYPES.has(mimeType) || /\.(md|markdown|txt)$/i.test(name);
  const isPdf = mimeType === "application/pdf";
  if (!isCsv && !isText && !isPdf) throw new GoogleDriveError("unsupported", "Unsupported Google file type.");

  const bytes = await readBytes(await googleFetch(`${DRIVE}/${id}?alt=media&supportsAllDrives=true`, token));
  if (isPdf) {
    try {
      return textResult(name, await pdfText(bytes));
    } catch {
      throw new GoogleDriveError("failed", "Couldn't read the PDF.");
    }
  }
  const content = new TextDecoder().decode(bytes);
  if (isCsv) return { kind: "table", name, ...valuesToTable(parseCsv(content, GOOGLE_DRIVE_LIMITS.maxRows + 1).rows) };
  return textResult(name, content);
}

/** Full-access mode: Drive-wide name search. Otherwise: only the connected files, filtered by name. */
export async function searchDriveFiles(userId: string, query: string): Promise<GoogleFile[]> {
  const term = query.trim().slice(0, 100);
  if (!isGoogleDriveFullAccess()) {
    const needle = term.toLowerCase();
    return (await listFiles(userId)).filter((file) => !needle || file.name.toLowerCase().includes(needle));
  }
  const token = await getValidAccessToken(userId);
  const q = [`trashed = false`, term ? `name contains ${driveQueryLiteral(term)}` : ""].filter(Boolean).join(" and ");
  const params = new URLSearchParams({
    q,
    pageSize: String(GOOGLE_DRIVE_LIMITS.searchResults),
    fields: "files(id,name,mimeType,webViewLink)",
    orderBy: "modifiedTime desc",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  const payload = (await (await googleFetch(`${DRIVE}?${params}`, token)).json()) as { files?: { id: string; name?: string; mimeType?: string; webViewLink?: string }[] };
  return (payload.files ?? []).map((file) => ({ id: file.id, name: file.name ?? file.id, mimeType: file.mimeType ?? "", url: file.webViewLink ?? "", addedAt: "" }));
}
