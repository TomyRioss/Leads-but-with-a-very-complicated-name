import { NextResponse } from "next/server";
import { getMercadoPagoClient } from "@/lib/server/mercadopago";
import { getOwnerSession, requireOwner } from "@/lib/server/owner";
import { recordOwnerAction } from "@/lib/server/owner-audit";
import { pocketBaseFetch } from "@/lib/server/pocketbase";
import {
  activeSubscriptionStatuses,
  countRecords,
  errorResponse,
  findUserSummary,
  filterString,
  isNotFound,
  isValidRecordId,
  listAllRecords,
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
  const session = await getOwnerSession(request);
  if ("response" in session) return session.response;
  const denied = pocketBaseNotReady();
  if (denied) return denied;
  const { id } = await context.params;
  if (!isValidRecordId(id)) return errorResponse("No encontramos ese usuario.", 404);

  const body = await readJsonObject(request);
  if (!body) return errorResponse("Los créditos no son válidos.", 400);
  const hasAbsolute = body.credits !== undefined;
  const hasDelta = body.addCredits !== undefined;
  const hasName = body.name !== undefined;
  if (Number(hasAbsolute) + Number(hasDelta) + Number(hasName) !== 1) {
    return errorResponse(hasName ? "Enviá solo uno: credits, addCredits o name." : "Enviá credits o addCredits, solo uno de los dos.", 400);
  }

  if (hasName) {
    if (typeof body.name !== "string" || body.name.trim().length > 100) return errorResponse("El nombre debe tener hasta 100 caracteres.", 400);
    const name = body.name.trim();
    try {
      const user = await findUserSummary(id);
      if (!user) return errorResponse("No encontramos ese usuario.", 404);
      await pocketBaseFetch(`/api/collections/users/records/${id}`, { method: "PATCH", body: JSON.stringify({ name }) });
      await recordOwnerAction(request, session.owner, {
        action: "user.update",
        targetType: "user",
        targetId: id,
        targetLabel: user.email,
        details: { name: { before: user.name || "", after: name } },
      });
      return NextResponse.json({ name });
    } catch (error) {
      console.error("Owner user update failed:", error instanceof Error ? error.name : "unknown");
      return errorResponse("No se pudo actualizar el usuario.", 502);
    }
  }

  const amount = hasAbsolute ? body.credits : body.addCredits;
  if (!isHalfStep(amount) || Math.abs(amount) > maxCredits || (hasAbsolute && amount < 0)) {
    return errorResponse("Los créditos deben ser múltiplos de 0,5, entre 0 y 1.000.000.", 400);
  }

  try {
    const user = await findUserSummary(id);
    if (!user) return errorResponse("No encontramos ese usuario.", 404);
    let before = 0;
    const credits = await updateUserCredits(id, (current) => {
      before = current;
      const next = hasAbsolute ? amount : current + amount;
      return next >= 0 && next <= maxCredits ? next : null;
    });
    if (credits === null) return errorResponse("El resultado debe quedar entre 0 y 1.000.000 créditos.", 400);
    await recordOwnerAction(request, session.owner, {
      action: hasAbsolute ? "user.credits_set" : "user.credits_add",
      targetType: "user",
      targetId: id,
      targetLabel: user.email,
      details: { creditsBefore: before, creditsAfter: credits, ...(hasDelta ? { delta: amount } : {}) },
    });
    return NextResponse.json({ credits });
  } catch (error) {
    if (error instanceof OwnerCreditsBusyError) return errorResponse(error.message, 409);
    if (isNotFound(error)) return errorResponse("No encontramos ese usuario.", 404);
    console.error("Owner credits update failed:", error instanceof Error ? error.name : "unknown");
    return errorResponse("No se pudieron actualizar los créditos.", 502);
  }
}

function remoteStatusCode(error: unknown) {
  return typeof error === "object" && error !== null && "status" in error ? Number((error as { status: unknown }).status) : 0;
}

export async function DELETE(request: Request, context: Context) {
  const session = await getOwnerSession(request);
  if ("response" in session) return session.response;
  const denied = pocketBaseNotReady();
  if (denied) return denied;
  const { id } = await context.params;
  if (!isValidRecordId(id)) return errorResponse("No encontramos ese usuario.", 404);

  const body = await readJsonObject(request);
  if (!body || typeof body.confirmEmail !== "string") return errorResponse("Confirmá el email del usuario para eliminarlo.", 400);

  let user;
  try {
    user = await findUserSummary(id);
  } catch (error) {
    console.error("Owner user delete lookup failed:", error instanceof Error ? error.name : "unknown");
    return errorResponse("No se pudo eliminar el usuario.", 502);
  }
  if (!user) return errorResponse("No encontramos ese usuario.", 404);
  if (user.role === "owner" || user.id === session.owner.id) return errorResponse("No se puede eliminar al owner ni a tu propia cuenta.", 403);
  if (body.confirmEmail.trim().toLowerCase() !== user.email.toLowerCase()) return errorResponse("El email de confirmación no coincide.", 400);

  const liveFilter = `user = ${filterString(id)} && (${activeSubscriptionStatuses.map((status) => `status = "${status}"`).join(" || ")}) && mp_subscription_id != ""`;
  const liveFields = { filter: liveFilter, fields: "id,mp_subscription_id" };
  const cancelledInMercadoPago: string[] = [];
  const auditFailure = (reason: string) => recordOwnerAction(request, session.owner, {
    action: "user.delete",
    targetType: "user",
    targetId: id,
    targetLabel: user.email,
    details: { status: "failed", reason, email: user.email, mercadoPagoCancelled: cancelledInMercadoPago },
  });

  try {
    // Subscriptions that Mercado Pago may still charge are cancelled there first.
    const live = await listAllRecords<SubscriptionRecord>("subscriptions", liveFields);
    if (live.length > 0) {
      const client = getMercadoPagoClient();
      if (!client) return errorResponse("Falta configurar MP_ACCESS_TOKEN en el servidor.", 503);
      for (const subscription of live) {
        let cancelled = false;
        try {
          await client.update({ id: subscription.mp_subscription_id, body: { status: "cancelled" } });
          cancelled = true;
        } catch (updateError) {
          console.error("Owner Mercado Pago cancellation before delete failed:", updateError instanceof Error ? updateError.name : "unknown");
          // The update may have failed on a stale state: if Mercado Pago already shows it cancelled (or gone), carry on.
          try {
            const remote = await client.get({ id: subscription.mp_subscription_id });
            cancelled = remote.status === "cancelled" || remote.status === "canceled";
          } catch (lookupError) {
            cancelled = remoteStatusCode(lookupError) === 404;
          }
        }
        if (!cancelled) {
          await auditFailure("mercado_pago_cancel_failed");
          return errorResponse(`Se canceló en Mercado Pago ${cancelledInMercadoPago.length} de ${live.length}; el usuario no se eliminó`, 502);
        }
        cancelledInMercadoPago.push(subscription.mp_subscription_id);
        await pocketBaseFetch(`/api/collections/subscriptions/records/${subscription.id}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "canceled" }),
        }).catch((error) => console.error("Owner subscription mark-canceled failed:", error instanceof Error ? error.name : "unknown"));
      }
    }

    // A subscription created meanwhile would be deleted without being cancelled in Mercado Pago.
    if ((await listAllRecords<SubscriptionRecord>("subscriptions", liveFields)).length > 0) {
      await auditFailure("new_subscription_appeared");
      return errorResponse("Apareció una suscripción nueva; reintentá", 409);
    }

    const [batches, leads, subscriptions] = await Promise.all([
      countRecords("lead_batches", `user = ${filterString(id)}`),
      countRecords("leads", `batch.user = ${filterString(id)}`),
      countRecords("subscriptions", `user = ${filterString(id)}`),
    ]);
    // lead_batches.user, leads.batch, subscriptions.user, subscription_payments.user and credit_locks.user all cascade on delete.
    await pocketBaseFetch(`/api/collections/users/records/${id}`, { method: "DELETE" });

    const deleted = { batches, leads, subscriptions };
    await recordOwnerAction(request, session.owner, {
      action: "user.delete",
      targetType: "user",
      targetId: id,
      targetLabel: user.email,
      details: { email: user.email, name: user.name || "", ...deleted, mercadoPagoCancelled: cancelledInMercadoPago },
    });
    return NextResponse.json({ ok: true, deleted });
  } catch (error) {
    console.error("Owner user delete failed:", error instanceof Error ? error.name : "unknown");
    await auditFailure("delete_failed");
    return errorResponse("No se pudo eliminar el usuario.", 502);
  }
}
