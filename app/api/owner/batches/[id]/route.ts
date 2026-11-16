import { NextResponse } from "next/server";
import { getOwnerSession } from "@/lib/server/owner";
import { deleteOwnerBatch } from "@/lib/server/owner-actions";
import { errorResponse, isValidRecordId, pocketBaseNotReady } from "../../_shared";
import { errorTranslator } from "@/lib/server/locale";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const t = errorTranslator(request);
  const session = await getOwnerSession(request);
  if ("response" in session) return session.response;
  const denied = pocketBaseNotReady(request);
  if (denied) return denied;
  const { id } = await context.params;
  if (!isValidRecordId(id)) return errorResponse(t("ownerBatchNotFound"), 404);

  const result = await deleteOwnerBatch(request, session.owner, id);
  return result.ok ? NextResponse.json({ ok: true, ...result.value }) : errorResponse(t(result.error), result.status);
}
