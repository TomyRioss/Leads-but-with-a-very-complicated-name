import { NextResponse } from "next/server";
import { getOwnerSession, requireOwner } from "@/lib/server/owner";
import { adjustOwnerUserCredits, deleteOwnerUser, isValidCreditAmount, parseUserProfileChanges, updateOwnerUserProfile } from "@/lib/server/owner-actions";
import {
  errorResponse,
  filterString,
  isValidRecordId,
  listRecords,
  normalizeCredits,
  pocketBaseNotReady,
  readJsonObject,
  toSubscriptionSummary,
  type PaymentRecord,
  type SubscriptionRecord,
  type UserRecord,
} from "../../_shared";
import { errorTranslator } from "@/lib/server/locale";

const historyLimit = 50;

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const t = errorTranslator(request);
  const denied = (await requireOwner(request)) ?? pocketBaseNotReady(request);
  if (denied) return denied;
  const { id } = await context.params;
  if (!isValidRecordId(id)) return errorResponse(t("ownerUserNotFound"), 404);

  const owned = `user = ${filterString(id)}`;
  try {
    const [user, subscriptions, payments] = await Promise.all([
      listRecords<UserRecord>("users", { perPage: 1, filter: `id = ${filterString(id)}`, fields: "id,email,name,credits,created,phone,role" }),
      listRecords<SubscriptionRecord>("subscriptions", { perPage: historyLimit + 1, sort: "-created", filter: owned, skipTotal: 1 }),
      listRecords<PaymentRecord>("subscription_payments", { perPage: historyLimit + 1, sort: "-created", filter: owned, skipTotal: 1 }),
    ]);
    const record = user.items[0];
    if (!record) return errorResponse(t("ownerUserNotFound"), 404);

    return NextResponse.json({
      user: { id: record.id, email: record.email, name: record.name || "", credits: normalizeCredits(record.credits), created: record.created, phone: record.phone || "", role: record.role === "owner" ? "owner" : "user" },
      subscriptionsHasMore: subscriptions.items.length > historyLimit,
      paymentsHasMore: payments.items.length > historyLimit,
      subscriptions: subscriptions.items.slice(0, historyLimit).map((subscription) => ({
        ...toSubscriptionSummary(subscription),
        externalReference: subscription.external_reference,
        created: subscription.created,
      })),
      payments: payments.items.slice(0, historyLimit).map((payment) => ({
        id: payment.id,
        paymentId: payment.payment_id,
        status: payment.status,
        amountArs: payment.amount_ars,
        credits: payment.credits,
        created: payment.created,
      })),
    });
  } catch (error) {
    console.error("Owner user detail failed:", error instanceof Error ? error.name : "unknown");
    return errorResponse(t("ownerUserLoadFailed"), 502);
  }
}

export async function PATCH(request: Request, context: Context) {
  const t = errorTranslator(request);
  const session = await getOwnerSession(request);
  if ("response" in session) return session.response;
  const denied = pocketBaseNotReady(request);
  if (denied) return denied;
  const { id } = await context.params;
  if (!isValidRecordId(id)) return errorResponse(t("ownerUserNotFound"), 404);

  const body = await readJsonObject(request);
  if (!body) return errorResponse(t("ownerCreditsInvalid"), 400);
  const hasAbsolute = body.credits !== undefined;
  const hasDelta = body.addCredits !== undefined;
  const hasProfile = body.name !== undefined || body.email !== undefined || body.phone !== undefined;
  if (hasAbsolute && hasDelta) return errorResponse(t("ownerCreditsOnlyOne"), 400);
  if (hasProfile && (hasAbsolute || hasDelta)) return errorResponse(t("ownerCreditsAndProfile"), 400);
  if (!hasProfile && !hasAbsolute && !hasDelta) return errorResponse(t("ownerSendCreditsOrProfile"), 400);

  if (hasProfile) {
    const parsed = parseUserProfileChanges(body);
    if (!parsed.ok) return errorResponse(t(parsed.error), parsed.status);
    const result = await updateOwnerUserProfile(request, session.owner, id, parsed.value);
    return result.ok ? NextResponse.json(result.value) : errorResponse(t(result.error), result.status);
  }

  const mode = hasAbsolute ? "set" : "add";
  const amount = hasAbsolute ? body.credits : body.addCredits;
  if (!isValidCreditAmount(mode, amount)) return errorResponse(t("ownerCreditsMultiple"), 400);
  const result = await adjustOwnerUserCredits(request, session.owner, id, mode, amount);
  return result.ok ? NextResponse.json({ credits: result.value.credits }) : errorResponse(t(result.error), result.status);
}

export async function DELETE(request: Request, context: Context) {
  const t = errorTranslator(request);
  const session = await getOwnerSession(request);
  if ("response" in session) return session.response;
  const denied = pocketBaseNotReady(request);
  if (denied) return denied;
  const { id } = await context.params;
  if (!isValidRecordId(id)) return errorResponse(t("ownerUserNotFound"), 404);

  const body = await readJsonObject(request);
  if (!body || typeof body.confirmEmail !== "string") return errorResponse(t("ownerConfirmEmailRequired"), 400);
  const result = await deleteOwnerUser(request, session.owner, id, body.confirmEmail);
  return result.ok ? NextResponse.json({ ok: true, deleted: result.value }) : errorResponse(t(result.error), result.status);
}
