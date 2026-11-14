import { GoogleFilesLimitError, GoogleNotConnectedError, addFiles, getValidAccessToken } from "@/lib/server/google-connections";
import { FILE_MIME_TYPES, json, requireUser, sameOrigin } from "../_shared";

const MAX_IDS = 20;
const idPattern = /^[A-Za-z0-9_-]{10,200}$/;

type DriveFile = { id: string; name: string; mimeType: string; webViewLink?: string; trashed?: boolean };

/** Agrega archivos elegidos en Picker: cada id se verifica con Drive files.get usando el token del propio usuario. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);
  const user = await requireUser(request);
  if (!user) return json({ error: "unauthorized" }, 401);

  let ids: string[];
  try {
    const raw = await request.text();
    if (raw.length > 8_000) return json({ error: "invalid_body" }, 413);
    const body = JSON.parse(raw) as { ids?: unknown };
    ids = Array.isArray(body.ids) ? [...new Set(body.ids.filter((id): id is string => typeof id === "string" && idPattern.test(id)))] : [];
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  if (!ids.length || ids.length > MAX_IDS) return json({ error: "invalid_body" }, 400);

  try {
    const token = await getValidAccessToken(user.id);
    const checked = await Promise.all(ids.map(async (id) => {
      const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id,name,mimeType,webViewLink,trashed&supportsAllDrives=true`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      }).catch(() => null);
      if (!response?.ok) return null;
      const file = await response.json() as DriveFile;
      return file.trashed || !FILE_MIME_TYPES.includes(file.mimeType) ? null : { id: file.id, name: file.name.slice(0, 300), mimeType: file.mimeType, url: file.webViewLink ?? "" };
    }));
    const valid = checked.filter((file): file is NonNullable<typeof file> => file !== null);
    if (!valid.length) return json({ error: "no_access" }, 422);
    const files = await addFiles(user.id, valid);
    return json({ files, rejected: ids.length - valid.length });
  } catch (error) {
    if (error instanceof GoogleNotConnectedError) return json({ error: "not_connected" }, 409);
    if (error instanceof GoogleFilesLimitError) return json({ error: "files_limit" }, 422);
    console.error("Google Drive add files failed", error instanceof Error ? error.name : "unknown");
    return json({ error: "add_failed" }, 503);
  }
}
