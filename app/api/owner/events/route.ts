import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/server/owner";
import { listRecords, pocketBaseNotReady } from "../_shared";
import { errorTranslator } from "@/lib/server/locale";

const limit = 20;

type UserRow = { id: string; email: string; name?: string; created: string; welcome_email_sent_at?: string };
type BatchRow = {
  id: string;
  user?: string;
  keywords: unknown;
  country: string;
  province?: string;
  district?: string;
  requested_count: number;
  result_count?: number;
  status: string;
  created_at: string;
  expand?: { user?: { id: string; email: string } };
};
type Details = Record<string, string | number>;
type OwnerEvent = { id: string; type: "signup" | "verified" | "leads"; email: string; count: number; date: string; details: Details };

const time = (value: string) => Date.parse(value.replace(" ", "T")) || 0;

/** Latest general events (signups, email verifications, lead batches), newest first. Read-only. */
export async function GET(request: Request) {
  const t = errorTranslator(request);
  const denied = (await requireOwner(request)) ?? pocketBaseNotReady(request);
  if (denied) return denied;

  try {
    // Three bounded queries in parallel; no per-row lookups.
    const [signups, verified, batches] = await Promise.all([
      listRecords<UserRow>("users", { perPage: limit, skipTotal: 1, sort: "-created", fields: "id,email,name,created" }),
      listRecords<UserRow>("users", {
        perPage: limit,
        skipTotal: 1,
        sort: "-welcome_email_sent_at",
        filter: 'verified = true && welcome_email_sent_at != ""',
        fields: "id,email,name,welcome_email_sent_at",
      }),
      listRecords<BatchRow>("lead_batches", {
        perPage: limit,
        skipTotal: 1,
        sort: "-created_at",
        expand: "user",
        fields: "id,user,keywords,country,province,district,requested_count,result_count,status,created_at,expand.user.id,expand.user.email",
      }),
    ]);

    const events: OwnerEvent[] = [
      ...signups.items.map((user): OwnerEvent => ({
        id: `signup-${user.id}`,
        type: "signup",
        email: user.email,
        count: 0,
        date: user.created,
        details: { userId: user.id, email: user.email, name: user.name || "" },
      })),
      ...verified.items.map((user): OwnerEvent => ({
        id: `verified-${user.id}`,
        type: "verified",
        email: user.email,
        count: 0,
        date: user.welcome_email_sent_at ?? "",
        details: { userId: user.id, email: user.email, name: user.name || "" },
      })),
      ...batches.items.map((batch): OwnerEvent => ({
        id: `leads-${batch.id}`,
        type: "leads",
        email: batch.expand?.user?.email ?? "",
        count: batch.result_count ?? 0,
        date: batch.created_at,
        details: {
          batchId: batch.id,
          userId: batch.user ?? "",
          email: batch.expand?.user?.email ?? "",
          keywords: Array.isArray(batch.keywords) ? batch.keywords.map(String).join(", ") : typeof batch.keywords === "string" ? batch.keywords : "",
          zone: [batch.district, batch.province, batch.country].filter(Boolean).join(", "),
          requestedCount: batch.requested_count,
          resultCount: batch.result_count ?? 0,
          status: batch.status,
        },
      })),
    ];

    return NextResponse.json({ items: events.filter((event) => event.date).sort((a, b) => time(b.date) - time(a.date)).slice(0, limit) });
  } catch (error) {
    console.error("Owner events failed:", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ error: t("ownerMetricsFailed") }, { status: 502 });
  }
}
