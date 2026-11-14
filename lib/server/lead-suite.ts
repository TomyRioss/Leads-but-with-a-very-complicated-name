import {
  computeLeadSuiteMetrics,
  fromPbDate,
  isContactStatus,
  normalizeChannel,
  normalizeLeadStatus,
  toPbDate,
  weekStartIso,
  type ContactStatus,
  type LeadContact,
  type LeadContactStatus,
  type LeadMatch,
  type LeadSuiteMetrics,
  type MetricsContactRow,
  type RecordContactInput,
  type WeeklyReport,
} from "@/lib/lead-suite";
import { PocketBaseRequestError, createLeadRecords, pocketBaseFetch } from "@/lib/server/pocketbase";
import type { AnalysisDetail } from "@/lib/types";

type List<T> = { items: T[]; page: number; totalPages: number };
type LeadRow = {
  id: string; name?: string; category?: string; phone?: string; website?: string; batch: string;
  contact_status?: string; last_contacted_at?: string;
  expand?: { batch?: { district?: string; province?: string } };
};
type ContactRow = {
  id: string; lead: string; channel: string; message?: string; status: string; notes?: string; contacted_at: string; created: string;
  expand?: { lead?: { name?: string } };
};
type ReportRow = { id: string; week_start: string; summary?: string; suggestions?: unknown; metrics?: LeadSuiteMetrics; sent_at?: string };

const quote = (value: string) => JSON.stringify(value);
const listPath = (collection: string, params: Record<string, string>) => `/api/collections/${collection}/records?${new URLSearchParams(params).toString()}`;
const recordPath = (collection: string, id: string) => `/api/collections/${collection}/records/${encodeURIComponent(id)}`;
const LEAD_FIELDS = "id,name,category,phone,website,batch,contact_status,last_contacted_at,expand.batch.district,expand.batch.province";
const CONTACT_FIELDS = "id,lead,channel,message,status,notes,contacted_at,created,expand.lead.name";
const ownLead = (userId: string) => `batch.user = ${quote(userId)}`;
const clampInt = (value: number | undefined, min: number, max: number, fallback: number) =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, Math.trunc(value!))) : fallback;

function toLead(row: LeadRow): LeadMatch {
  const batch = row.expand?.batch;
  return {
    id: row.id,
    name: row.name ?? "",
    category: row.category ?? "",
    city: batch?.district || batch?.province || "",
    phone: row.phone ?? "",
    website: row.website ?? "",
    batchId: row.batch,
    contactStatus: normalizeLeadStatus(row.contact_status),
    lastContactedAt: fromPbDate(row.last_contacted_at),
  };
}

function toContact(row: ContactRow, leadName?: string): LeadContact {
  return {
    id: row.id,
    leadId: row.lead,
    leadName: leadName ?? row.expand?.lead?.name ?? "",
    channel: normalizeChannel(row.channel),
    message: row.message ?? "",
    status: isContactStatus(row.status) ? row.status : "contacted",
    notes: row.notes ?? "",
    contactedAt: fromPbDate(row.contacted_at) ?? row.contacted_at,
    created: fromPbDate(row.created) ?? row.created,
  };
}

function validIso(value: string | undefined) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export async function findUserLeads(userId: string, query: string, limit = 10): Promise<LeadMatch[]> {
  const term = query.trim().slice(0, 120);
  if (!term) return [];
  const result = await pocketBaseFetch<List<LeadRow>>(listPath("leads", {
    // PocketBase `~` is a case-insensitive contains (LIKE).
    filter: `${ownLead(userId)} && name ~ ${quote(term)}`,
    sort: "-last_contacted_at,name",
    perPage: String(clampInt(limit, 1, 10, 10)),
    skipTotal: "1",
    expand: "batch",
    fields: LEAD_FIELDS,
  }));
  return result.items.map(toLead);
}

/** Leads del usuario paginados, con filtro opcional por estado de contacto y por nombre. */
export async function listUserLeads(
  userId: string,
  opts: { page?: number; perPage?: number; status?: LeadContactStatus; query?: string },
): Promise<{ items: LeadMatch[]; page: number; totalPages: number }> {
  const filters = [ownLead(userId)];
  // PocketBase guarda el estado vacío como "" para los leads sin contactar.
  if (opts.status) filters.push(`contact_status = ${quote(opts.status === "not_contacted" ? "" : opts.status)}`);
  const term = opts.query?.trim().slice(0, 120);
  if (term) filters.push(`name ~ ${quote(term)}`);
  const result = await pocketBaseFetch<List<LeadRow>>(listPath("leads", {
    filter: filters.join(" && "),
    sort: "name",
    page: String(clampInt(opts.page, 1, 10_000, 1)),
    perPage: String(clampInt(opts.perPage, 1, 50, 20)),
    expand: "batch",
    fields: LEAD_FIELDS,
  }));
  return { items: result.items.map(toLead), page: result.page, totalPages: result.totalPages };
}

export async function getUserLead(userId: string, leadId: string): Promise<LeadMatch | null> {
  if (!leadId) return null;
  const result = await pocketBaseFetch<List<LeadRow>>(listPath("leads", {
    filter: `id = ${quote(leadId)} && ${ownLead(userId)}`,
    perPage: "1",
    skipTotal: "1",
    expand: "batch",
    fields: LEAD_FIELDS,
  }));
  return result.items[0] ? toLead(result.items[0]) : null;
}

async function requireLead(userId: string, leadId: string) {
  const lead = await getUserLead(userId, leadId);
  if (!lead) throw new Error("Lead not found.");
  return lead;
}

export async function recordLeadContact(userId: string, input: RecordContactInput): Promise<LeadContact> {
  const lead = await requireLead(userId, input.leadId);
  const contactedAt = validIso(input.contactedAt);
  if (!contactedAt) throw new Error("Invalid contactedAt.");
  const status: ContactStatus = isContactStatus(input.status) ? input.status : "contacted";
  const created = await pocketBaseFetch<ContactRow>("/api/collections/lead_contacts/records", {
    method: "POST",
    body: JSON.stringify({
      lead: lead.id,
      user: userId,
      channel: normalizeChannel(input.channel),
      message: (input.message ?? "").slice(0, 4000),
      status,
      notes: (input.notes ?? "").slice(0, 2000),
      contacted_at: toPbDate(contactedAt),
    }),
  });
  // A plain "contacted" log doesn't downgrade a lead that already replied / has a meeting / closed.
  const nextStatus = input.status || lead.contactStatus === "not_contacted" ? status : lead.contactStatus;
  const lastContactedAt = lead.lastContactedAt && lead.lastContactedAt > contactedAt ? lead.lastContactedAt : contactedAt;
  await pocketBaseFetch(recordPath("leads", lead.id), {
    method: "PATCH",
    body: JSON.stringify({ contact_status: nextStatus, last_contacted_at: toPbDate(lastContactedAt) }),
  });
  return toContact(created, lead.name);
}

export async function updateLeadContactStatus(userId: string, leadId: string, status: ContactStatus): Promise<LeadMatch> {
  if (!isContactStatus(status)) throw new Error("Invalid status.");
  const lead = await requireLead(userId, leadId);
  await pocketBaseFetch(recordPath("leads", lead.id), { method: "PATCH", body: JSON.stringify({ contact_status: status }) });
  return { ...lead, contactStatus: status };
}

/** Light directory of the user's leads for fuzzy name matching in the chat. */
export async function listLeadDirectory(userId: string): Promise<LeadMatch[]> {
  // ponytail: capped at 4 * 500 leads per user; move to a server-side search index if users outgrow it.
  const rows = await fetchAllPages<LeadRow>("leads", { filter: ownLead(userId), sort: "-last_contacted_at,name", expand: "batch", fields: LEAD_FIELDS }, 4);
  return rows.map(toLead);
}

export async function getLeadContact(userId: string, contactId: string): Promise<LeadContact | null> {
  if (!contactId) return null;
  const result = await pocketBaseFetch<List<ContactRow>>(listPath("lead_contacts", {
    filter: `id = ${quote(contactId)} && user = ${quote(userId)}`,
    perPage: "1",
    skipTotal: "1",
    expand: "lead",
    fields: CONTACT_FIELDS,
  }));
  return result.items[0] ? toContact(result.items[0]) : null;
}

/** Recomputes the lead's last_contacted_at from its remaining contacts; no contacts left = not contacted. */
async function refreshLeadSummary(userId: string, leadId: string, status?: ContactStatus) {
  const { items } = await listLeadContacts(userId, { leadId, perPage: 1 });
  const latest = items[0];
  const patch: Record<string, string> = { last_contacted_at: latest ? toPbDate(latest.contactedAt) : "" };
  if (!latest) patch.contact_status = "";
  else if (status) patch.contact_status = status;
  await pocketBaseFetch(recordPath("leads", leadId), { method: "PATCH", body: JSON.stringify(patch) });
}

export type LeadContactPatch = Partial<Pick<RecordContactInput, "channel" | "message" | "contactedAt" | "status" | "notes">>;

export async function updateLeadContact(userId: string, contactId: string, patch: LeadContactPatch): Promise<LeadContact> {
  const contact = await getLeadContact(userId, contactId);
  if (!contact) throw new Error("Contact not found.");
  await requireLead(userId, contact.leadId);
  const body: Record<string, string> = {};
  if (patch.channel !== undefined) body.channel = normalizeChannel(patch.channel);
  if (patch.message !== undefined) body.message = patch.message.slice(0, 4000);
  if (patch.notes !== undefined) body.notes = patch.notes.slice(0, 2000);
  if (patch.status !== undefined) {
    if (!isContactStatus(patch.status)) throw new Error("Invalid status.");
    body.status = patch.status;
  }
  if (patch.contactedAt !== undefined) {
    const contactedAt = validIso(patch.contactedAt);
    if (!contactedAt) throw new Error("Invalid contactedAt.");
    body.contacted_at = toPbDate(contactedAt);
  }
  const saved = await pocketBaseFetch<ContactRow>(recordPath("lead_contacts", contact.id), { method: "PATCH", body: JSON.stringify(body) });
  if (body.contacted_at || body.status) await refreshLeadSummary(userId, contact.leadId, patch.status);
  return toContact(saved, contact.leadName);
}

export async function deleteLeadContact(userId: string, contactId: string): Promise<LeadContact> {
  const contact = await getLeadContact(userId, contactId);
  if (!contact) throw new Error("Contact not found.");
  await requireLead(userId, contact.leadId);
  await pocketBaseFetch(recordPath("lead_contacts", contact.id), { method: "DELETE" });
  await refreshLeadSummary(userId, contact.leadId);
  return contact;
}

export async function listLeadContacts(
  userId: string,
  opts: { leadId?: string; from?: string; to?: string; page?: number; perPage?: number },
): Promise<{ items: LeadContact[]; page: number; totalPages: number }> {
  // Contacts carry `user`, so filtering by it is the ownership check.
  const filters = [`user = ${quote(userId)}`];
  if (opts.leadId) filters.push(`lead = ${quote(opts.leadId)}`);
  const from = validIso(opts.from);
  const to = validIso(opts.to);
  if (from) filters.push(`contacted_at >= ${quote(toPbDate(from))}`);
  if (to) filters.push(`contacted_at <= ${quote(toPbDate(to))}`);
  const result = await pocketBaseFetch<List<ContactRow>>(listPath("lead_contacts", {
    filter: filters.join(" && "),
    sort: "-contacted_at",
    page: String(clampInt(opts.page, 1, 10_000, 1)),
    perPage: String(clampInt(opts.perPage, 1, 100, 20)),
    expand: "lead",
    fields: CONTACT_FIELDS,
  }));
  return { items: result.items.map((row) => toContact(row)), page: result.page, totalPages: result.totalPages };
}

async function fetchAllPages<T>(collection: string, params: Record<string, string>, maxPages = 20): Promise<T[]> {
  // ponytail: capped at maxPages * 500 rows per user; move to SQL aggregation if users outgrow it.
  const rows: T[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const result = await pocketBaseFetch<List<T>>(listPath(collection, { ...params, page: String(page), perPage: "500" }));
    rows.push(...result.items);
    if (page >= result.totalPages) break;
  }
  return rows;
}

export async function getLeadSuiteMetrics(userId: string, range: { from: string; to: string }): Promise<LeadSuiteMetrics> {
  const from = validIso(range.from);
  const to = validIso(range.to);
  if (!from || !to) throw new Error("Invalid range.");
  // Two independent queries in parallel: all contacts (light fields) and all contacted leads.
  const [contactRows, leadRows] = await Promise.all([
    fetchAllPages<{ lead: string; channel: string; contacted_at: string }>("lead_contacts", {
      filter: `user = ${quote(userId)}`,
      sort: "-contacted_at",
      fields: "lead,channel,contacted_at",
    }),
    fetchAllPages<LeadRow>("leads", {
      filter: `${ownLead(userId)} && last_contacted_at != ""`,
      sort: "last_contacted_at",
      expand: "batch",
      fields: LEAD_FIELDS,
    }),
  ]);
  const contacts: MetricsContactRow[] = contactRows.map((row) => ({
    leadId: row.lead,
    channel: normalizeChannel(row.channel),
    contactedAt: fromPbDate(row.contacted_at) ?? row.contacted_at,
  }));
  const leads = new Map(leadRows.map((row) => [row.id, toLead(row)]));
  return computeLeadSuiteMetrics(contacts, leads, { from, to });
}

export async function listWeeklyReportUsers(page: number): Promise<{ items: { id: string; email: string; name: string; locale: string }[]; totalPages: number }> {
  const since = toPbDate(new Date(Date.now() - 30 * 86_400_000));
  const result = await pocketBaseFetch<List<{ id: string; email: string; name?: string }>>(listPath("users", {
    filter: `lead_contacts_via_user.contacted_at >= ${quote(since)}`,
    sort: "created",
    page: String(clampInt(page, 1, 10_000, 1)),
    perPage: "100",
    fields: "id,email,name",
  }));
  // ponytail: users have no locale field yet; default locale until one exists.
  return { items: result.items.map((user) => ({ id: user.id, email: user.email, name: user.name ?? "", locale: "es" })), totalPages: result.totalPages };
}

export async function saveWeeklyReport(userId: string, report: WeeklyReport): Promise<void> {
  const weekStart = toPbDate(weekStartIso(report.weekStart));
  const body = JSON.stringify({
    user: userId,
    week_start: weekStart,
    summary: report.summary,
    suggestions: report.suggestions,
    metrics: report.metrics,
    sent_at: report.sentAt ? toPbDate(report.sentAt) : "",
  });
  const existing = await pocketBaseFetch<List<{ id: string }>>(listPath("lead_suite_reports", {
    filter: `user = ${quote(userId)} && week_start = ${quote(weekStart)}`,
    perPage: "1",
    skipTotal: "1",
    fields: "id",
  }));
  const id = existing.items[0]?.id;
  await pocketBaseFetch(id ? recordPath("lead_suite_reports", id) : "/api/collections/lead_suite_reports/records", { method: id ? "PATCH" : "POST", body });
}

export async function getLatestWeeklyReport(userId: string): Promise<WeeklyReport | null> {
  let result: List<ReportRow>;
  try {
    result = await pocketBaseFetch<List<ReportRow>>(listPath("lead_suite_reports", {
      filter: `user = ${quote(userId)}`,
      sort: "-week_start",
      perPage: "1",
      skipTotal: "1",
      fields: "id,week_start,summary,suggestions,metrics,sent_at",
    }));
  } catch (error) {
    // The report is optional: a missing collection (migration not applied) must not take the dashboard down.
    if (error instanceof PocketBaseRequestError && error.status === 404) {
      console.error("Lead Suite weekly report unavailable:", error.operation, error.detail.slice(0, 200));
      return null;
    }
    throw error;
  }
  const row = result.items[0];
  if (!row || !row.metrics) return null;
  return {
    weekStart: (fromPbDate(row.week_start) ?? row.week_start).slice(0, 10),
    summary: row.summary ?? "",
    suggestions: Array.isArray(row.suggestions) ? row.suggestions.filter((s): s is string => typeof s === "string") : [],
    metrics: row.metrics,
    sentAt: fromPbDate(row.sent_at),
  };
}

// ---------- Leadtita: idempotency helpers and extra capabilities ----------

/** Same user + lead + channel + time + message already logged (a confirmed card replayed). */
export async function findDuplicateContact(userId: string, input: RecordContactInput): Promise<LeadContact | null> {
  const contactedAt = validIso(input.contactedAt);
  if (!contactedAt) return null;
  const result = await pocketBaseFetch<List<ContactRow>>(listPath("lead_contacts", {
    filter: [
      `user = ${quote(userId)}`,
      `lead = ${quote(input.leadId)}`,
      `channel = ${quote(normalizeChannel(input.channel))}`,
      `contacted_at = ${quote(toPbDate(contactedAt))}`,
      `message = ${quote((input.message ?? "").slice(0, 4000))}`,
    ].join(" && "),
    perPage: "1",
    skipTotal: "1",
    expand: "lead",
    fields: CONTACT_FIELDS,
  }));
  return result.items[0] ? toContact(result.items[0]) : null;
}

export type LeadPainBrief = {
  lead: LeadMatch;
  email: string;
  tags: string[];
  report: string;
  proposals: { variant: string; service: string; message: string }[];
  analyzed: boolean;
  focus: string;
};

/** What Leadtita needs to draft a message: analyzed pains, proposals and contact data. */
export async function getLeadPainBrief(userId: string, leadId: string): Promise<LeadPainBrief | null> {
  const lead = await getUserLead(userId, leadId);
  if (!lead) return null;
  const row = await pocketBaseFetch<{ email?: string; pain_points?: string; pain_points_detail?: AnalysisDetail | null }>(
    `${recordPath("leads", lead.id)}?fields=email,pain_points,pain_points_detail`,
  );
  const detail = row.pain_points_detail;
  const tags = Array.isArray(detail?.tags) ? detail.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 4) : [];
  return {
    lead,
    email: row.email ?? "",
    tags,
    report: (detail?.report || row.pain_points || "").slice(0, 1200),
    proposals: Array.isArray(detail?.proposals) ? detail.proposals.slice(0, 2).map((p) => ({ variant: p.variant, service: p.service, message: p.message.slice(0, 1200) })) : [],
    analyzed: detail?.status === "completed" || tags.length > 0,
    focus: detail?.focus ?? "",
  };
}

export type ManualLeadInput = { name: string; category?: string; city?: string; phone?: string; email?: string; website?: string };
const MANUAL_BATCH_COUNTRY = "Manual";

/** Adds a lead to the user's "Manual" batch (created on first use). Replaying the same lead returns the existing one. */
export async function addManualLead(userId: string, input: ManualLeadInput): Promise<{ lead: LeadMatch; batchId: string; created: boolean }> {
  const name = input.name.trim().slice(0, 255);
  if (!name) throw new Error("Lead name is required.");
  const existingBatch = await pocketBaseFetch<List<{ id: string; result_count?: number }>>(listPath("lead_batches", {
    filter: `user = ${quote(userId)} && country = ${quote(MANUAL_BATCH_COUNTRY)} && province = "" && district = ""`,
    sort: "created_at",
    perPage: "1",
    skipTotal: "1",
    fields: "id,result_count",
  }));
  const isNewBatch = !existingBatch.items[0];
  // requested_count can't be 0: a new Manual batch starts at 1 (this lead) and grows by one per added lead.
  const batchId = existingBatch.items[0]?.id ?? (await pocketBaseFetch<{ id: string }>("/api/collections/lead_batches/records", {
    method: "POST",
    body: JSON.stringify({
      user: userId,
      keywords: [MANUAL_BATCH_COUNTRY],
      country: MANUAL_BATCH_COUNTRY,
      province: "",
      district: "",
      requested_count: 1,
      result_count: 0,
      status: "completed",
      created_at: new Date().toISOString(),
    }),
  })).id;

  const phone = (input.phone ?? "").trim().slice(0, 100);
  const email = (input.email ?? "").trim().slice(0, 500);
  const duplicate = await pocketBaseFetch<List<LeadRow>>(listPath("leads", {
    filter: `batch = ${quote(batchId)} && name = ${quote(name)} && phone = ${quote(phone)} && email = ${quote(email)}`,
    perPage: "1",
    skipTotal: "1",
    expand: "batch",
    fields: LEAD_FIELDS,
  }));
  if (duplicate.items[0]) return { lead: toLead(duplicate.items[0]), batchId, created: false };

  const website = (input.website ?? "").trim();
  const city = (input.city ?? "").trim().slice(0, 160);
  const { created } = await createLeadRecords(batchId, [{
    name,
    category: (input.category ?? "").trim().slice(0, 500),
    address: city,
    phone,
    email,
    website: /^https?:\/\/\S+$/i.test(website) ? website.slice(0, 1000) : "",
    created_at: new Date().toISOString(),
  }]);
  if (!created) throw new Error("Couldn't save the lead.");
  await pocketBaseFetch(recordPath("lead_batches", batchId), { method: "PATCH", body: JSON.stringify(isNewBatch ? { "result_count+": 1 } : { "result_count+": 1, "requested_count+": 1 }) });
  const saved = await pocketBaseFetch<List<LeadRow>>(listPath("leads", {
    filter: `batch = ${quote(batchId)} && name = ${quote(name)}`,
    sort: "-created_at",
    perPage: "1",
    skipTotal: "1",
    expand: "batch",
    fields: LEAD_FIELDS,
  }));
  if (!saved.items[0]) throw new Error("Couldn't read the saved lead.");
  return { lead: { ...toLead(saved.items[0]), city: city || toLead(saved.items[0]).city }, batchId, created: true };
}

/** A batch the user already launched with the same parameters after `sinceIso` (a confirmed search replayed). */
export async function findRecentBatch(userId: string, opts: { sinceIso: string; requestedCount: number; kind: "business" | "person"; query?: string; keyword?: string }) {
  const filters = [
    `user = ${quote(userId)}`,
    `created_at >= ${quote(toPbDate(opts.sinceIso))}`,
    `requested_count = ${Math.trunc(opts.requestedCount)}`,
    opts.kind === "person" ? `kind = "person" && query = ${quote(opts.query ?? "")}` : `kind != "person" && keywords ~ ${quote(opts.keyword ?? "")}`,
  ];
  const result = await pocketBaseFetch<List<{ id: string; result_count?: number; status?: string }>>(listPath("lead_batches", {
    filter: filters.join(" && "),
    sort: "-created_at",
    perPage: "1",
    skipTotal: "1",
    fields: "id,result_count,status",
  }));
  return result.items[0] ?? null;
}
