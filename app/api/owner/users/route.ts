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
import { errorTranslator } from "@/lib/server/locale";

const time = (value: string) => Date.parse(value.replace(" ", "T")) || 0;

function positiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.min(parsed, max) : fallback;
}

export async function GET(request: Request) {
  const t = errorTranslator(request);
  const denied = (await requireOwner(request)) ?? pocketBaseNotReady(request);
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const page = positiveInt(params.get("page"), 1, 100_000);
  const perPage = positiveInt(params.get("perPage"), 25, 100);
  const q = (params.get("q") ?? "").trim().slice(0, 100);
  const query: Record<string, string | number> = {
    page,
    perPage,
    sort: "-created",
    fields: "id,email,name,credits,created,updated,role,phone",
  };
  if (q) query.filter = `email ~ ${filterString(q)} || name ~ ${filterString(q)}`;

  try {
    const users = await listRecords<UserRecord>("users", query);
    const latestByUser = new Map<string, SubscriptionRecord>();

    const lastActivity = new Map<string, string>();
    const touch = (id: string | undefined, date: string | undefined) => {
      if (!id || !date) return;
      const current = lastActivity.get(id);
      if (!current || time(date) > time(current)) lastActivity.set(id, date);
    };

    if (users.items.length > 0) {
      const ids = users.items.map((user) => filterString(user.id));
      const owners = ids.map((id) => `user = ${id}`).join(" || ");
      const statuses = activeSubscriptionStatuses.map((status) => `status = "${status}"`).join(" || ");
      // Aggregated reads for the whole page, in parallel (no per-user queries). Each is newest first and capped,
      // so a very busy user can crowd out the rest of the page: those fall back to their other signals.
      const [subscriptions, batches, payments, audit] = await Promise.all([
        // The first hit per user is its latest subscription.
        listAllRecords<SubscriptionRecord>("subscriptions", {
          sort: "-created",
          filter: `(${owners}) && (${statuses})`,
          fields: "id,user,plan_id,status,price_ars,monthly_credits,created",
        }),
        listRecords<{ user: string; created_at: string }>("lead_batches", { perPage: 200, skipTotal: 1, sort: "-created_at", filter: `(${owners})`, fields: "user,created_at" }).then((r) => r.items),
        listRecords<{ user: string; created: string }>("subscription_payments", { perPage: 200, skipTotal: 1, sort: "-created", filter: `(${owners})`, fields: "user,created" }).then((r) => r.items),
        listRecords<{ actor_email: string; created: string }>("owner_audit_log", {
          perPage: 200,
          skipTotal: 1,
          sort: "-created",
          filter: users.items.map((user) => `actor_email = ${filterString(user.email)}`).join(" || "),
          fields: "actor_email,created",
        }).then((r) => r.items).catch(() => []),
      ]);
      for (const subscription of subscriptions) {
        if (!latestByUser.has(subscription.user)) latestByUser.set(subscription.user, subscription);
        touch(subscription.user, subscription.created);
      }
      for (const batch of batches) touch(batch.user, batch.created_at);
      for (const payment of payments) touch(payment.user, payment.created);
      const idByEmail = new Map(users.items.map((user) => [user.email, user.id]));
      for (const entry of audit) touch(idByEmail.get(entry.actor_email), entry.created);
      for (const user of users.items) touch(user.id, user.updated);
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
          phone: user.phone || "",
          lastActivity: lastActivity.get(user.id) ?? "",
          role: user.role === "owner" ? "owner" : "user",
          subscription: subscription ? toSubscriptionSummary(subscription) : null,
        };
      }),
      page: users.page,
      totalPages: users.totalPages,
      totalItems: users.totalItems,
    });
  } catch (error) {
    console.error("Owner users list failed:", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ error: t("ownerUsersLoadFailed") }, { status: 502 });
  }
}
