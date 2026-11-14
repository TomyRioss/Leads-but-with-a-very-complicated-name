import { NextResponse } from "next/server";
import { getOwnerSession } from "@/lib/server/owner";
import { recordOwnerAction } from "@/lib/server/owner-audit";
import { sendFeedbackThanksEmail } from "@/lib/server/email";
import { getFeedbackIssue, isLinearConfigured, setFeedbackIssueState } from "@/lib/server/linear";
import { errorTranslator } from "@/lib/server/locale";
import { errorResponse, findUserSummary, maxCredits, OwnerCreditsBusyError, pocketBaseNotReady, updateUserCredits } from "../../_shared";

type Context = { params: Promise<{ id: string }> };

const FEEDBACK_REWARD_CREDITS = 50;

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

  let feedback;
  try {
    feedback = await getFeedbackIssue(id);
  } catch (error) {
    console.error("Owner feedback lookup failed:", error instanceof Error ? error.message.slice(0, 200) : "unknown");
    return errorResponse(t("ownerFeedbackCloseFailed"), 502);
  }
  if (!feedback?.user) return errorResponse(t("ownerFeedbackNotFound"), 404);
  if (feedback.state === "closed") return errorResponse(t("ownerFeedbackAlreadyClosed"), 409);
  // El email vigente sale de la cuenta (pudo cambiar desde que escribió); si la cuenta ya no existe no hay a quién premiar.
  const account = await findUserSummary(feedback.user.id).catch(() => null);
  if (!account) return errorResponse(t("ownerUserNotFound"), 404);
  const author = { ...feedback.user, email: account.email };

  // ponytail: dos cierres simultáneos del mismo comentario podrían sumar dos veces; el botón se bloquea mientras corre.
  try {
    await setFeedbackIssueState(feedback.id, "closed");
  } catch (error) {
    console.error("Owner feedback close failed:", error instanceof Error ? error.message.slice(0, 200) : "unknown");
    return errorResponse(t("ownerFeedbackCloseFailed"), 502);
  }

  let before = 0;
  let credits: number | null;
  try {
    credits = await updateUserCredits(author.id, (current) => {
      before = current;
      const next = current + FEEDBACK_REWARD_CREDITS;
      return next <= maxCredits ? next : null;
    });
    if (credits === null) throw new Error("Credit limit reached.");
  } catch (error) {
    // Sin créditos no queda cerrado: se reabre para poder reintentar.
    await setFeedbackIssueState(feedback.id, "open").catch(() => undefined);
    if (error instanceof OwnerCreditsBusyError) return errorResponse(t("ownerCreditsBusy"), 409);
    console.error("Owner feedback credits failed:", error instanceof Error ? error.message.slice(0, 200) : "unknown");
    return errorResponse(t("ownerFeedbackCloseFailed"), 502);
  }

  await recordOwnerAction(request, session.owner, {
    action: "user.credits_add",
    targetType: "user",
    targetId: author.id,
    targetLabel: author.email,
    details: { creditsBefore: before, creditsAfter: credits, delta: FEEDBACK_REWARD_CREDITS, reason: `feedback ${feedback.identifier}` },
  });

  let emailSent = true;
  try {
    await sendFeedbackThanksEmail({ to: author.email, locale: author.locale, credits: FEEDBACK_REWARD_CREDITS, issueId: feedback.id });
  } catch (error) {
    emailSent = false;
    console.error("Feedback thanks email failed:", error instanceof Error ? error.message.slice(0, 200) : "unknown");
  }

  return NextResponse.json({ ok: true, credits, emailSent });
}
