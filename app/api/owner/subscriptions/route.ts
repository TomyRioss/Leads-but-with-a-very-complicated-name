import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/server/owner";
import { errorResponse, filterString, listRecords, pocketBaseNotReady, type SubscriptionRecord } from "../_shared";

const statuses = ["authorized", "paused", "pending", "canceled", "cancelled", "rejected", "creating"];
type Row = SubscriptionRecord & { expand?: { user?: { id: string; email: string } } };

function positiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.min(parsed, max) : fallback;
}

export async function GET(request: Request) {
  const denied = (await requireOwner(request)) ?? pocketBaseNotReady();
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const status = params.get("status") ?? "";
  if (status && !statuses.includes(status)) return errorResponse("El estado no es válido.", 400);
  const q = (params.get("q") ?? "").trim().slice(0, 100);
  const filters = [status && `status = ${filterString(status)}`, q && `user.email ~ ${filterString(q)}`].filter(Boolean);

  try {
    const result = await listRecords<Row>("subscriptions", {
      page: positiveInt(params.get("page"), 1, 100_000),
      perPage: positiveInt(params.get("perPage"), 25, 100),
      sort: "-created",
      expand: "user",
      fields: "id,user,plan_id,status,price_ars,monthly_credits,external_reference,created,expand.user.id,expand.user.email",
      ...(filters.length ? { filter: filters.join(" && ") } : {}),
    });
    return NextResponse.json({
      items: result.items.map((item) => ({
        id: item.id,
        userId: item.user,
        userEmail: item.expand?.user?.email ?? "",
        planId: item.plan_id,
        status: item.status,
        priceArs: item.price_ars,
        monthlyCredits: item.monthly_credits,
        externalReference: item.external_reference,
        created: item.created,
      })),
      page: result.page,
      totalPages: result.totalPages,
      totalItems: result.totalItems,
    });
  } catch (error) {
    console.error("Owner subscriptions list failed:", error instanceof Error ? error.name : "unknown");
    return errorResponse("No se pudieron cargar las suscripciones.", 502);
  }
}
