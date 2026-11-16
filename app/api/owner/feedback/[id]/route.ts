import { NextResponse } from "next/server";
import { getOwnerSession } from "@/lib/server/owner";
import { closeOwnerFeedback } from "@/lib/server/owner-actions";
import { isLinearConfigured } from "@/lib/server/linear";
import { errorTranslator } from "@/lib/server/locale";
import { errorResponse, pocketBaseNotReady } from "../../_shared";

type Context = { params: Promise<{ id: string }> };

/**
 * Cierra un comentario: lo pasa a Done en Linear, suma 50 créditos al autor y le manda el correo de agradecimiento.
 * El estado de Linear funciona como candado: un comentario cerrado no vuelve a dar créditos.
 */
export async function POST(request: Request, context: Context) {
  const t = errorTranslator(request);
  const session = await getOwnerSession(request);
  if ("response" in session) return session.response;
  const denied = pocketBaseNotReady(request);
  if (denied) return denied;
  if (!isLinearConfigured()) return errorResponse(t("linearNotConfigured"), 503);

  const { id } = await context.params;
  if (!/^[A-Za-z0-9-]{1,64}$/.test(id)) return errorResponse(t("ownerFeedbackNotFound"), 404);

  const result = await closeOwnerFeedback(request, session.owner, id);
  return result.ok ? NextResponse.json({ ok: true, ...result.value }) : errorResponse(t(result.error), result.status);
}
