import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/server/owner";
import { errorResponse, filterString, listRecords, pocketBaseNotReady } from "../_shared";

// Payment statuses ("processing" while crediting, "processed" once credited).
const statuses = ["processing", "processed", "approved", "pending", "rejected", "failed", "canceled", "cancelled", "refunded"];
type Row = {
  id: string;
  payment_id: string;
  status: string;
  amount_ars: number;
  credits: number;
  balance_before: number;
  subscription: string;
  user: string;
  created: string;
  expand?: { user?: { id: string; email: string } };
};

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
    const result = await listRecords<Row>("subscription_payments", {
      page: positiveInt(params.get("page"), 1, 100_000),
      perPage: positiveInt(params.get("perPage"), 25, 100),
      sort: "-created",
      expand: "user",
      fields: "id,payment_id,status,amount_ars,credits,balance_before,subscription,user,created,expand.user.id,expand.user.email",
      ...(filters.length ? { filter: filters.join(" && ") } : {}),
    });
    return NextResponse.json({
      items: result.items.map((item) => ({
        id: item.id,
        paymentId: item.payment_id,
        status: item.status,
        amountArs: item.amount_ars,
        credits: item.credits,
        balanceBefore: item.balance_before,
        userId: item.user,
        userEmail: item.expand?.user?.email ?? "",
        subscriptionId: item.subscription,
        created: item.created,
      })),
      page: result.page,
      totalPages: result.totalPages,
      totalItems: result.totalItems,
    });
  } catch (error) {
    console.error("Owner payments list failed:", error instanceof Error ? error.name : "unknown");
    return errorResponse("No se pudieron cargar los pagos.", 502);
  }
}
