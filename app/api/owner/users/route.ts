import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/server/owner";
import {
  activeSubscriptionStatuses,
  filterString,
  listAllRecords,
  listRecords,
  normalizeCredits,
  pocketBaseNotReady,
  toSubscriptionSummary,
  type SubscriptionRecord,
  type UserRecord,
} from "../_shared";

function positiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.min(parsed, max) : fallback;
}

export async function GET(request: Request) {
  const denied = (await requireOwner(request)) ?? pocketBaseNotReady();
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const page = positiveInt(params.get("page"), 1, 100_000);
  const perPage = positiveInt(params.get("perPage"), 25, 100);
  const q = (params.get("q") ?? "").trim().slice(0, 100);
  const query: Record<string, string | number> = {
    page,
    perPage,
    sort: "-created",
    fields: "id,email,name,credits,created",
  };
  if (q) query.filter = `email ~ ${filterString(q)} || name ~ ${filterString(q)}`;

  try {
    const users = await listRecords<UserRecord>("users", query);
    const latestByUser = new Map<string, SubscriptionRecord>();

    if (users.items.length > 0) {
      // One query for the whole page, newest first: the first hit per user is its latest subscription.
      const owners = users.items.map((user) => `user = ${filterString(user.id)}`).join(" || ");
      const statuses = activeSubscriptionStatuses.map((status) => `status = "${status}"`).join(" || ");
      const subscriptions = await listAllRecords<SubscriptionRecord>("subscriptions", {
        sort: "-created",
        filter: `(${owners}) && (${statuses})`,
        fields: "id,user,plan_id,status,price_ars,monthly_credits",
      });
      for (const subscription of subscriptions) {
        if (!latestByUser.has(subscription.user)) latestByUser.set(subscription.user, subscription);
      }
    }

    return NextResponse.json({
      items: users.items.map((user) => {
        const subscription = latestByUser.get(user.id);
        return {
          id: user.id,
          email: user.email,
          name: user.name || "",
          credits: normalizeCredits(user.credits),
          created: user.created,
          subscription: subscription ? toSubscriptionSummary(subscription) : null,
        };
      }),
      page: users.page,
      totalPages: users.totalPages,
      totalItems: users.totalItems,
    });
  } catch (error) {
    console.error("Owner users list failed:", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ error: "No se pudieron cargar los usuarios." }, { status: 502 });
  }
}
