import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/server/owner";
import {
  errorResponse,
  filterString,
  isNotFound,
  isValidRecordId,
  listRecords,
  maxCredits,
  normalizeCredits,
  OwnerCreditsBusyError,
  pocketBaseNotReady,
  readJsonObject,
  toSubscriptionSummary,
  updateUserCredits,
  type PaymentRecord,
  type SubscriptionRecord,
  type UserRecord,
} from "../../_shared";

const historyLimit = 50;

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const denied = (await requireOwner(request)) ?? pocketBaseNotReady();
  if (denied) return denied;
  const { id } = await context.params;
  if (!isValidRecordId(id)) return errorResponse("No encontramos ese usuario.", 404);

  const owned = `user = ${filterString(id)}`;
  try {
    const [user, subscriptions, payments] = await Promise.all([
      listRecords<UserRecord>("users", { perPage: 1, filter: `id = ${filterString(id)}`, fields: "id,email,name,credits,created" }),
      listRecords<SubscriptionRecord>("subscriptions", { perPage: historyLimit + 1, sort: "-created", filter: owned, skipTotal: 1 }),
      listRecords<PaymentRecord>("subscription_payments", { perPage: historyLimit + 1, sort: "-created", filter: owned, skipTotal: 1 }),
    ]);
    const record = user.items[0];
    if (!record) return errorResponse("No encontramos ese usuario.", 404);

    return NextResponse.json({
      user: { id: record.id, email: record.email, name: record.name || "", credits: normalizeCredits(record.credits), created: record.created },
      subscriptionsHasMore: subscriptions.items.length > historyLimit,
      paymentsHasMore: payments.items.length > historyLimit,
      subscriptions: subscriptions.items.slice(0, historyLimit).map((subscription) => ({
        ...toSubscriptionSummary(subscription),
        externalReference: subscription.external_reference,
        manual: !subscription.mp_subscription_id,
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
    return errorResponse("No se pudo cargar el usuario.", 502);
  }
}

function isHalfStep(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value * 2);
}

export async function PATCH(request: Request, context: Context) {
  const denied = (await requireOwner(request)) ?? pocketBaseNotReady();
  if (denied) return denied;
  const { id } = await context.params;
  if (!isValidRecordId(id)) return errorResponse("No encontramos ese usuario.", 404);

  const body = await readJsonObject(request);
  if (!body) return errorResponse("Los créditos no son válidos.", 400);
  const hasAbsolute = body.credits !== undefined;
  const hasDelta = body.addCredits !== undefined;
  if (hasAbsolute === hasDelta) return errorResponse("Enviá credits o addCredits, solo uno de los dos.", 400);

  const amount = hasAbsolute ? body.credits : body.addCredits;
  if (!isHalfStep(amount) || Math.abs(amount) > maxCredits || (hasAbsolute && amount < 0)) {
    return errorResponse("Los créditos deben ser múltiplos de 0,5, entre 0 y 1.000.000.", 400);
  }

  try {
    const credits = await updateUserCredits(id, (current) => {
      const next = hasAbsolute ? amount : current + amount;
      return next >= 0 && next <= maxCredits ? next : null;
    });
    if (credits === null) return errorResponse("El resultado debe quedar entre 0 y 1.000.000 créditos.", 400);
    return NextResponse.json({ credits });
  } catch (error) {
    if (error instanceof OwnerCreditsBusyError) return errorResponse(error.message, 409);
    if (isNotFound(error)) return errorResponse("No encontramos ese usuario.", 404);
    console.error("Owner credits update failed:", error instanceof Error ? error.name : "unknown");
    return errorResponse("No se pudieron actualizar los créditos.", 502);
  }
}
