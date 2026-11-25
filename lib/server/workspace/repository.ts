import "server-only";
import type { Lead } from "@/lib/types";
import type { Business, Proposal, SalesCampaign } from "@/lib/workspace/types";
import { PocketBaseRequestError, pocketBaseFetch } from "@/lib/server/pocketbase";
import {
  campaignBatchIds,
  isRecordId,
  quote,
  toBusiness,
  toProposal,
  toSalesCampaign,
  WORKSPACE_LIMITS,
  type BusinessRow,
  type CampaignRow,
  type ProposalRow,
} from "@/lib/server/workspace/mapping";

// Adaptador PocketBase de businesses / sales_campaigns / proposals. Colecciones solo superuser:
// cada lectura y escritura pasa por acá con el filtro user = <id de la sesión>.
type List<T> = { items: T[] };

const records = (collection: string) => `/api/collections/${collection}/records`;
const recordPath = (collection: string, id: string) => `${records(collection)}/${encodeURIComponent(id)}`;
const listPath = (collection: string, params: Record<string, string>) => `${records(collection)}?${new URLSearchParams({ skipTotal: "1", ...params })}`;
const own = (userId: string, extra = "") => `user = ${quote(userId)}${extra ? ` && ${extra}` : ""}`;
const anyOf = (field: string, ids: string[]) => `(${ids.map((id) => `${field} = ${quote(id)}`).join(" || ")})`;
// Filtros OR acotados para no pasar el largo de URL de PocketBase.
const ID_CHUNK = 80;
const chunks = <T>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));

async function findOwn<T>(collection: string, userId: string, id: string): Promise<T | null> {
  if (!isRecordId(id)) return null;
  const list = await pocketBaseFetch<List<T>>(listPath(collection, { filter: own(userId, `id = ${quote(id)}`), perPage: "1" }));
  return list.items[0] ?? null;
}

// ---------- Negocios ----------

export async function listBusinesses(userId: string): Promise<Business[]> {
  const list = await pocketBaseFetch<List<BusinessRow>>(listPath("businesses", { filter: own(userId), sort: "-created", perPage: String(WORKSPACE_LIMITS.businesses) }));
  return list.items.map(toBusiness);
}

export async function getBusiness(userId: string, id: string): Promise<Business | null> {
  const row = await findOwn<BusinessRow>("businesses", userId, id);
  return row ? toBusiness(row) : null;
}

/** Crea el negocio de una corrida; si ya existe (índice único landing_run) devuelve el existente. */
export async function createBusinessForRun(record: { user: string; landing_run: string } & Record<string, unknown>): Promise<string> {
  try {
    return (await pocketBaseFetch<{ id: string }>(records("businesses"), { method: "POST", body: JSON.stringify(record) })).id;
  } catch (error) {
    if (!(error instanceof PocketBaseRequestError) || error.status !== 400) throw error;
    const existing = await pocketBaseFetch<List<{ id: string }>>(listPath("businesses", { filter: own(record.user, `landing_run = ${quote(record.landing_run)}`), perPage: "1", fields: "id" }));
    if (existing.items[0]) return existing.items[0].id;
    throw error;
  }
}

/** Crea un negocio del usuario (onboarding). `user` siempre sale de la sesión, nunca de `fields`. */
export async function createBusiness(userId: string, fields: Record<string, unknown>): Promise<Business> {
  const row = await pocketBaseFetch<BusinessRow>(records("businesses"), { method: "POST", body: JSON.stringify({ ...fields, user: userId }) });
  return toBusiness(row);
}

/** PATCH de un negocio solo si es del usuario; null si no existe o es de otro. */
export async function updateBusiness(userId: string, id: string, patch: Record<string, unknown>): Promise<Business | null> {
  if (!(await findOwn<{ id: string }>("businesses", userId, id))) return null;
  const data = { ...patch };
  delete data.user; // el dueño no cambia nunca
  const row = await pocketBaseFetch<BusinessRow>(recordPath("businesses", id), { method: "PATCH", body: JSON.stringify(data) });
  return toBusiness(row);
}

// ---------- Campañas ----------

/** result_count de cada lote del usuario, en una consulta por cada 80 ids (sin N+1). */
async function batchResultCounts(userId: string, batchIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const unique = [...new Set(batchIds)];
  await Promise.all(chunks(unique, ID_CHUNK).map(async (ids) => {
    const list = await pocketBaseFetch<List<{ id: string; result_count?: number }>>(listPath("lead_batches", { filter: own(userId, anyOf("id", ids)), fields: "id,result_count", perPage: String(ids.length) }));
    for (const row of list.items) counts.set(row.id, Math.max(0, Number(row.result_count) || 0));
  }));
  return counts;
}

export async function listCampaigns(userId: string, businessId?: string): Promise<SalesCampaign[]> {
  const filter = own(userId, businessId ? `business = ${quote(businessId)}` : "");
  const list = await pocketBaseFetch<List<CampaignRow>>(listPath("sales_campaigns", { filter, sort: "-fit,-created", perPage: String(WORKSPACE_LIMITS.campaigns) }));
  const counts = await batchResultCounts(userId, list.items.flatMap(campaignBatchIds));
  return list.items.map((row) => toSalesCampaign(row, counts));
}

export async function getCampaign(userId: string, id: string): Promise<SalesCampaign | null> {
  const row = await findOwn<CampaignRow>("sales_campaigns", userId, id);
  if (!row) return null;
  return toSalesCampaign(row, await batchResultCounts(userId, campaignBatchIds(row)));
}

export async function createCampaign(record: Record<string, unknown>): Promise<string> {
  return (await pocketBaseFetch<{ id: string }>(records("sales_campaigns"), { method: "POST", body: JSON.stringify(record) })).id;
}

/** Agrega un lote a la campaña (operador "+" de PocketBase: sin leer-y-escribir). */
export async function appendCampaignBatch(campaignId: string, batchId: string): Promise<void> {
  await pocketBaseFetch(recordPath("sales_campaigns", campaignId), { method: "PATCH", body: JSON.stringify({ "batches+": batchId }) });
}

/** Leads de los lotes de la campaña, solo de lotes del usuario. Tope WORKSPACE_LIMITS.campaignLeads. */
export async function listCampaignLeads(userId: string, batchIds: string[]): Promise<Lead[]> {
  const ids = [...new Set(batchIds.filter(isRecordId))];
  if (!ids.length) return [];
  const limit = WORKSPACE_LIMITS.campaignLeads;
  const pages = await Promise.all(chunks(ids, ID_CHUNK).map((group) =>
    pocketBaseFetch<List<Lead>>(listPath("leads", { filter: `batch.user = ${quote(userId)} && ${anyOf("batch", group)}`, sort: "-created_at", perPage: String(limit) }))));
  return pages.flatMap((page) => page.items).slice(0, limit);
}

// ---------- Propuestas ----------

export async function listProposals(userId: string, opts: { campaignId?: string; businessId?: string }): Promise<Proposal[]> {
  const extra = [opts.campaignId && `campaign = ${quote(opts.campaignId)}`, opts.businessId && `business = ${quote(opts.businessId)}`].filter(Boolean).join(" && ");
  const list = await pocketBaseFetch<List<ProposalRow>>(listPath("proposals", { filter: own(userId, extra), sort: "-created", perPage: String(WORKSPACE_LIMITS.proposals) }));
  return list.items.map(toProposal);
}

export async function getProposal(userId: string, id: string): Promise<Proposal | null> {
  const row = await findOwn<ProposalRow>("proposals", userId, id);
  return row ? toProposal(row) : null;
}

export async function createProposal(record: Record<string, unknown>): Promise<string> {
  return (await pocketBaseFetch<{ id: string }>(records("proposals"), { method: "POST", body: JSON.stringify(record) })).id;
}

/** PATCH de una propuesta ya verificada como propia. */
export async function patchProposal(id: string, data: Record<string, unknown>): Promise<Proposal> {
  return toProposal(await pocketBaseFetch<ProposalRow>(recordPath("proposals", id), { method: "PATCH", body: JSON.stringify(data) }));
}

/** Email del lead (si es del usuario), para propuestas Gmail sin destinatario. */
export async function getLeadEmail(userId: string, leadId: string): Promise<string> {
  if (!isRecordId(leadId)) return "";
  const list = await pocketBaseFetch<List<{ email?: string }>>(listPath("leads", { filter: `id = ${quote(leadId)} && batch.user = ${quote(userId)}`, fields: "email", perPage: "1" }));
  return list.items[0]?.email?.trim() ?? "";
}
