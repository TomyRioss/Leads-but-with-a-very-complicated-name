import { NextResponse } from "next/server";
import { getCurrentUser, withRefreshedSession } from "@/lib/server/auth";
import { uiError } from "@/lib/server/public-error";
import { errorTranslator } from "@/lib/server/locale";
import { ATTACHMENT_LIMITS, AttachmentError, extractAttachment, type AttachmentContext } from "@/lib/server/leadtita-attachments";

// Node.js is the default runtime (a `runtime` export is rejected with cacheComponents).
export const maxDuration = 120;

// Whole multipart request: every file at the limit plus form overhead.
const MAX_REQUEST_BYTES = ATTACHMENT_LIMITS.maxFiles * ATTACHMENT_LIMITS.maxBytes + 64 * 1024;
const RATE_WINDOW_MS = 10 * 60_000;
const RATE_MAX_FILES = 30;
// ponytail: per-instance memory, so the cap is per serverless instance; move to a shared store if abuse shows up.
const recentUploads = new Map<string, number[]>();

function rateLimited(userId: string, files: number) {
  const now = Date.now();
  const recent = (recentUploads.get(userId) ?? []).filter((at) => now - at < RATE_WINDOW_MS);
  if (recent.length + files > RATE_MAX_FILES) {
    recentUploads.set(userId, recent);
    return true;
  }
  recentUploads.set(userId, [...recent, ...Array(files).fill(now)]);
  if (recentUploads.size > 5000) recentUploads.delete(recentUploads.keys().next().value!);
  return false;
}

/** Extracts attachments in memory (nothing is stored) and returns bounded contexts for the chat. Free. */
export async function POST(request: Request) {
  const t = errorTranslator(request);
  let session: Awaited<ReturnType<typeof getCurrentUser>>;
  try {
    session = await getCurrentUser(request);
  } catch {
    return NextResponse.json({ error: t("accountService") }, { status: 503 });
  }
  if (!session) return NextResponse.json({ error: t("signInToContinue") }, { status: 401 });
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return NextResponse.json({ error: uiError(t("openRouterKeyMissing"), t("generic")) }, { status: 503 });

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (!declared || declared > MAX_REQUEST_BYTES) return NextResponse.json({ error: t("invalidRequestBody"), code: "size" }, { status: 413 });

  let files: File[];
  try {
    const form = await request.formData();
    files = form.getAll("files").filter((value): value is File => value instanceof File);
  } catch {
    return NextResponse.json({ error: t("invalidRequestBody") }, { status: 400 });
  }
  if (!files.length || files.length > ATTACHMENT_LIMITS.maxFiles) return NextResponse.json({ error: t("invalidRequestBody"), code: "count" }, { status: 400 });
  if (rateLimited(session.user.id, files.length)) return NextResponse.json({ error: t("invalidRequestBody"), code: "rate" }, { status: 429 });

  // Files are independent: extract in parallel (≤5), each failure reported per file.
  const results = await Promise.all(files.map(async (file): Promise<{ name: string; attachment?: AttachmentContext; error?: AttachmentError["code"] }> => {
    if (file.size > ATTACHMENT_LIMITS.maxBytes) return { name: file.name, error: "size" };
    try {
      const attachment = await extractAttachment({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }, { apiKey, signal: request.signal, userId: session.user.id });
      return { name: file.name, attachment };
    } catch (error) {
      if (!(error instanceof AttachmentError)) console.error("Leadtita attachment failed", error);
      return { name: file.name, error: error instanceof AttachmentError ? error.code : "extract" };
    }
  }));
  return withRefreshedSession(NextResponse.json({ results }), session.token);
}
