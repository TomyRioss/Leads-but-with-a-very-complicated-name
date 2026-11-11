import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/server/owner";
import { listAllRecords, listRecords, normalizeCredits, pocketBaseDate, pocketBaseNotReady } from "../_shared";
import { errorTranslator } from "@/lib/server/locale";

const day = 24 * 60 * 60 * 1000;

export async function GET(request: Request) {
  const t = errorTranslator(request);
  const denied = (await requireOwner(request)) ?? pocketBaseNotReady(request);
  if (denied) return denied;

  const since = `"${pocketBaseDate(new Date(Date.now() - 30 * day))}"`;
  try {
    const [subscriptions, totalUsers, newUsers, users, payments] = await Promise.all([
      listAllRecords<{ plan_id: string; status: string; price_ars: number }>("subscriptions", {
        filter: 'status = "authorized" || status = "paused"',
        fields: "plan_id,status,price_ars",
      }),
      listRecords("users", { perPage: 1, fields: "id" }),
      listRecords("users", { perPage: 1, fields: "id", filter: `created >= ${since}` }),
      listAllRecords<{ credits?: number }>("users", { fields: "credits" }),
      // "processed" is the status of a payment already credited.
      listAllRecords<{ amount_ars?: number }>("subscription_payments", {
        filter: `status = "processed" && created >= ${since}`,
        fields: "amount_ars",
      }),
    ]);

    const plans = new Map<string, { planId: string; count: number; mrrArs: number }>();
    let mrrArs = 0;
    let activeSubscriptions = 0;
    let pausedSubscriptions = 0;
    for (const subscription of subscriptions) {
      if (subscription.status === "paused") {
        pausedSubscriptions++;
        continue;
      }
      const price = subscription.price_ars || 0;
      activeSubscriptions++;
      mrrArs += price;
      const entry = plans.get(subscription.plan_id) ?? { planId: subscription.plan_id, count: 0, mrrArs: 0 };
      entry.count++;
      entry.mrrArs += price;
      plans.set(subscription.plan_id, entry);
    }

    return NextResponse.json({
      mrrArs,
      activeSubscriptions,
      pausedSubscriptions,
      totalUsers: totalUsers.totalItems,
      newUsers30d: newUsers.totalItems,
      creditsInCirculation: users.reduce((sum, user) => sum + normalizeCredits(user.credits), 0),
      revenue30dArs: payments.reduce((sum, payment) => sum + (payment.amount_ars || 0), 0),
      planBreakdown: [...plans.values()],
    });
  } catch (error) {
    console.error("Owner overview failed:", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ error: t("ownerMetricsFailed") }, { status: 502 });
  }
}
