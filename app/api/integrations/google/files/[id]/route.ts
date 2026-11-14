import { removeFile } from "@/lib/server/google-connections";
import { json, requireUser, sameOrigin } from "../../_shared";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);
  const user = await requireUser(request);
  if (!user) return json({ error: "unauthorized" }, 401);
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(id)) return json({ error: "invalid_id" }, 400);
  try {
    return json({ files: await removeFile(user.id, id) });
  } catch (error) {
    console.error("Google Drive remove file failed", error instanceof Error ? error.name : "unknown");
    return json({ error: "remove_failed" }, 503);
  }
}
