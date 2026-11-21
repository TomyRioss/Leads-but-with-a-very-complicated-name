import { signPendingChange } from "@/lib/server/lead-suite-agent";
import { getUserBatch, isSearchBatch } from "@/lib/server/lead-suite";
import { deleteBatchLeads } from "@/lib/server/leads";
import { pocketBaseFetch } from "@/lib/server/pocketbase";
import { checkWhatsAppNumbers, whatsAppDigits } from "@/lib/server/whatsapp";
import { TOPUP_MAX_MISSING } from "@/lib/lead-rules";

export type WhatsAppStatus = "" | "verified" | "none";
type Row = { id: string; phone?: string; whatsapp?: string; whatsapp_status?: WhatsAppStatus };
const SEPARATOR = "\n";
const WRITE_CONCURRENCY = 5;

const listRows = (batchId: string) =>
  pocketBaseFetch<{ items: Row[] }>(`/api/collections/leads/records?perPage=150&skipTotal=1&sort=created_at&fields=id,phone,whatsapp,whatsapp_status&filter=${encodeURIComponent(`batch = "${batchId}"`)}`).then((result) => result.items);

async function setStatuses(changes: { id: string; status: WhatsAppStatus }[]) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(WRITE_CONCURRENCY, changes.length) }, async () => {
    while (next < changes.length) {
      const { id, status } = changes[next++];
      await pocketBaseFetch(`/api/collections/leads/records/${id}`, { method: "PATCH", body: JSON.stringify({ whatsapp_status: status }) }).catch(() => undefined);
    }
  }));
}

/** Checks every lead of one of the user's batches. A lead with no usable number has no WhatsApp. null = batch not found. */
export async function analyzeBatchWhatsApp(userId: string, batchId: string) {
  if (!(await getUserBatch(userId, batchId))) return null;
  const rows = await listRows(batchId);
  const digits = new Map(rows.map((row) => [row.id, whatsAppDigits(row.whatsapp ?? "") || whatsAppDigits(row.phone ?? "")]));
  // Leads already verified (or marked without WhatsApp) are not looked up again.
  const pending = rows.filter((row) => !row.whatsapp_status).map((row) => digits.get(row.id) ?? "").filter(Boolean);
  const checked = await checkWhatsAppNumbers(pending);
  const statuses: Record<string, WhatsAppStatus> = {};
  const changes: { id: string; status: WhatsAppStatus }[] = [];
  let unknown = 0;
  for (const row of rows) {
    const phone = digits.get(row.id) ?? "";
    const result = row.whatsapp_status ? row.whatsapp_status === "verified" : phone ? checked.get(phone) ?? null : false;
    const status: WhatsAppStatus = result === null ? "" : result ? "verified" : "none";
    if (result === null) unknown++;
    statuses[row.id] = status;
    if (status !== (row.whatsapp_status ?? "")) changes.push({ id: row.id, status });
  }
  await setStatuses(changes);
  const values = Object.values(statuses);
  return { statuses, verified: values.filter((value) => value === "verified").length, none: values.filter((value) => value === "none").length, unknown };
}

/**
 * Replaces the batch's leads without WhatsApp with new ones registered on WhatsApp, at no cost: a free top-up signed here
 * (missing = leads to replace). The old leads are deleted only after, and only as many as the new ones, so the user never
 * loses a lead without getting one back and never gets more than they replaced. No refund for the removed leads.
 */
export async function replaceNoWhatsApp(userId: string, batchId: string, runSearch: (topUp: string) => Promise<{ status: number; body: Record<string, unknown> }>) {
  const batch = await getUserBatch(userId, batchId);
  if (!batch) return { error: "batch_not_found" as const };
  const none = (await listRows(batchId)).filter((row) => row.whatsapp_status === "none").map((row) => row.id).slice(0, TOPUP_MAX_MISSING);
  if (!none.length) return { replaced: 0, remaining: 0, leads: [] as unknown[] };
  const countries = batch.country.split(", ").map((value) => value.trim()).filter(Boolean);
  if (!isSearchBatch(batch) || !batch.keywords.length || !batch.country || /\s\+\d+$/.test(batch.country)) return { error: "not_replaceable" as const };
  const multi = countries.length > 1;
  const topUp = signPendingChange({
    uid: userId, kind: "topup_batch", leadId: "", leadName: "", data: {},
    extra: {
      batchId, keywords: batch.keywords.join(SEPARATOR), country: batch.country,
      ...(multi ? { countries: countries.join(SEPARATOR) } : {}),
      ...(!multi && batch.province ? { province: batch.province } : {}), ...(!multi && batch.district ? { district: batch.district } : {}),
      skipClosed: 1, missing: none.length, round: batch.topupRounds + 1, free: 1, wa: 1, credits: 0,
    },
  });
  const result = await runSearch(topUp);
  if (result.status < 200 || result.status > 299) return { error: "search_failed" as const, status: result.status, body: result.body };
  const leads = Array.isArray(result.body.leads) ? result.body.leads : [];
  const replaced = Math.min(leads.length, none.length);
  if (replaced > 0) await deleteBatchLeads(userId, batchId, none.slice(0, replaced));
  return { replaced, remaining: none.length - replaced, leads };
}
