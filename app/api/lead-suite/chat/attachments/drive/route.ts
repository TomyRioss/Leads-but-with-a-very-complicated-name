import { NextResponse } from "next/server";
import { getCurrentUser, withRefreshedSession } from "@/lib/server/auth";
import { errorTranslator } from "@/lib/server/locale";
import { GoogleNotConnectedError } from "@/lib/server/google-connections";
import { GoogleDriveError, readDriveFile } from "@/lib/server/google-drive";
import { driveToContext } from "@/lib/server/leadtita-attachments";

export const maxDuration = 60;

/** Reads one connected Google Drive file and returns it as a chat attachment context (same pipeline as uploads). */
export async function POST(request: Request) {
  const t = errorTranslator(request);
  let session: Awaited<ReturnType<typeof getCurrentUser>>;
  try {
    session = await getCurrentUser(request);
  } catch {
    return NextResponse.json({ error: t("accountService") }, { status: 503 });
  }
  if (!session) return NextResponse.json({ error: t("signInToContinue") }, { status: 401 });

  let fileId: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 1000) return NextResponse.json({ error: t("invalidRequestBody") }, { status: 413 });
    fileId = (JSON.parse(raw) as { fileId?: unknown })?.fileId;
  } catch {
    return NextResponse.json({ error: t("invalidRequestBody") }, { status: 400 });
  }
  if (typeof fileId !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(fileId)) return NextResponse.json({ error: t("invalidRequestBody") }, { status: 400 });

  try {
    // readDriveFile only reads files the user connected (drive.file) unless full-access mode is on.
    const attachment = driveToContext(await readDriveFile(session.user.id, fileId));
    return withRefreshedSession(NextResponse.json({ attachment }), session.token);
  } catch (error) {
    if (error instanceof GoogleNotConnectedError) return NextResponse.json({ error: t("generic"), code: "not_connected" }, { status: 409 });
    if (error instanceof GoogleDriveError) {
      const status = error.code === "not_found" ? 404 : error.code === "forbidden" ? 403 : error.code === "too_large" ? 413 : error.code === "unsupported" ? 415 : 502;
      return NextResponse.json({ error: t("generic"), code: error.code }, { status });
    }
    console.error("Drive attachment failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: t("generic"), code: "failed" }, { status: 502 });
  }
}
