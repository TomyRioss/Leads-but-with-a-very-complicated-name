import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/server/owner";
import {
  activeSubscriptionStatuses,
  filterString,
  listAllRecords,
  listRecords,
  normalizeCredits,
  pocketBaseNotReady,
  resolveSort,
  toSubscriptionSummary,
  type SubscriptionRecord,
  type UserRecord,
} from "../_shared";
import { errorTranslator } from "@/lib/server/locale";

// Direct columns sort in PocketBase; last activity is aggregated before pagination.
const sortColumns = { email: "email", name: "name", credits: "credits", created: "created", phone: "phone" };

const time = (value: string) => Date.parse(value.replace(" ", "T")) || 0;

function positiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.min(parsed, max) : fallback;
}

async function readComplete<T>(collection: string, params: Record<string, string>) {
  const items = await listAllRecords<T>(collection, params);
  if (items.length >= 100_000) throw new Error("Owner activity sorting read limit reached");
  return items;
}

export async function GET(request: Request) {
  const t = errorTranslator(request);
  const denied = (await requireOwner(request)) ?? pocketBaseNotReady(request);
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const page = positiveInt(params.get("page"), 1, 100_000);
  const perPage = positiveInt(params.get("perPage"), 25, 100);
  const q = (params.get("q") ?? "").trim().slice(0, 100);
  const activitySort = params.get("sort");
  const sortByActivity = activitySort === "lastActivity" || activitySort === "-lastActivity";
  const query: Record<string, string | number> = {
    page,
    perPage,
    sort: resolveSort(params.get("sort"), sortColumns, "-created"),
    fields: "id,email,name,credits,created,updated,role,phone",
  };
  if (q) query.filter = `email ~ ${filterString(q)} || name ~ ${filterString(q)}`;

  try {
    // For aggregate sorting, load all matching users before selecting the requested page.
    const users = sortByActivity
      ? await (async () => {
          const items = await readComplete<UserRecord>("users", {
            sort: "-created,id",
            fields: String(query.fields),
            ...(q ? { filter: String(query.filter) } : {}),
          });
          return { items, page, totalPages: Math.ceil(items.length / perPage), totalItems: items.length };
        })()
      : await listRecords<UserRecord>("users", query);
    const latestByUser = new Map<string, SubscriptionRecord>();

    const lastActivity = new Map<string, string>();
    const touch = (id: string | undefined, date: string | undefined) => {
      if (!id || !date) return;
      const current = lastActivity.get(id);
      if (!current || time(date) > time(current)) lastActivity.set(id, date);
    };

    // Keep filters short and concurrency bounded to four source reads, regardless of user count.
    for (let offset = 0; offset < users.items.length; offset += 50) {
      const chunk = users.items.slice(offset, offset + 50);
      const ids = chunk.map((user) => filterString(user.id));
      const owners = ids.map((id) => `user = ${id}`).join(" || ");
      const statuses = activeSubscriptionStatuses.map((status) => `status = "${status}"`).join(" || ");
      // Aggregate sorting must read every activity page: a busy account must not crowd out others.
      const readActivity = <T,>(collection: string, params: Record<string, string>) => sortByActivity
        ? readComplete<T>(collection, params)
        : listRecords<T>(collection, { ...params, perPage: 200, skipTotal: 1 }).then((result) => result.items);
      const [subscriptions, batches, payments, audit] = await Promise.all([
        // The first hit per user is its latest subscription.
        (sortByActivity ? readComplete<SubscriptionRecord> : listAllRecords<SubscriptionRecord>)("subscriptions", {
          sort: "-created",
          filter: `(${owners}) && (${statuses})`,
          fields: "id,user,plan_id,status,price_ars,monthly_credits,created",
        }),
        readActivity<{ user: string; created_at: string }>("lead_batches", { sort: "-created_at", filter: `(${owners})`, fields: "user,created_at" }),
        readActivity<{ user: string; created: string }>("subscription_payments", { sort: "-created", filter: `(${owners})`, fields: "user,created" }),
        readActivity<{ actor_email: string; created: string }>("owner_audit_log", {
          sort: "-created",
          filter: chunk.map((user) => `actor_email = ${filterString(user.email)}`).join(" || "),
          fields: "actor_email,created",
        }).catch((error: unknown) => {
          if (sortByActivity) throw error;
          return [];
        }),
      ]);
      for (const subscription of subscriptions) {
        if (!latestByUser.has(subscription.user)) latestByUser.set(subscription.user, subscription);
        touch(subscription.user, subscription.created);
      }
      for (const batch of batches) touch(batch.user, batch.created_at);
      for (const payment of payments) touch(payment.user, payment.created);
      const idByEmail = new Map(chunk.map((user) => [user.email, user.id]));
      for (const entry of audit) touch(idByEmail.get(entry.actor_email), entry.created);
      for (const user of chunk) touch(user.id, user.updated);
    }

    if (sortByActivity) {
      const direction = activitySort === "-lastActivity" ? -1 : 1;
      users.items.sort((a, b) => direction * (time(lastActivity.get(a.id) ?? "") - time(lastActivity.get(b.id) ?? ""))
        || time(b.created) - time(a.created) || a.id.localeCompare(b.id));
      users.items = users.items.slice((page - 1) * perPage, page * perPage);
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
