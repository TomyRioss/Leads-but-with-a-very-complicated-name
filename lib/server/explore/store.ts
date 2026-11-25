import { createHash, randomBytes } from "node:crypto";
import type { ExploreInput, ExploreLead, ExploreRun } from "@/lib/explore/types";
import { createLeadRecords, pocketBaseFetch } from "@/lib/server/pocketbase";

// Adaptador PocketBase de landing_runs (flujo público /explorar). Colección solo superuser: reglas en null.
const COLLECTION = "landing_runs";
const IP_SALT = "leadta-explore-ip-v1";

type RunRecord = {
  id: string;
  input: ExploreInput;
  campaign_id?: string;
  product?: ExploreRun["product"];
  competitors?: ExploreRun["competitors"];
  campaigns?: ExploreRun["campaigns"];
  leads?: ExploreRun["leads"];
  proposals?: ExploreRun["proposals"];
  claimed_by?: string;
};

type List<T> = { items: T[]; totalItems?: number };

const quote = (value: string) => JSON.stringify(value);
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const listPath = (params: Record<string, string>) => `/api/collections/${COLLECTION}/records?${new URLSearchParams(params)}`;

export function hashIp(ip: string): string {
  return sha256(`${IP_SALT}:${ip}`);
}

async function findRecord(token: string): Promise<RunRecord | null> {
  if (!token) return null;
  const list = await pocketBaseFetch<List<RunRecord>>(listPath({ filter: `token_hash = ${quote(sha256(token))}`, perPage: "1", skipTotal: "1" }));
  return list.items[0] ?? null;
}

export async function createRun(input: ExploreInput, ipHash: string): Promise<{ token: string }> {
  const token = randomBytes(32).toString("base64url");
  await pocketBaseFetch(`/api/collections/${COLLECTION}/records`, {
    method: "POST",
    body: JSON.stringify({ token_hash: sha256(token), ip_hash: ipHash, input, campaign_id: "" }),
  });
  return { token };
}

export async function getRun(token: string): Promise<ExploreRun | null> {
  const record = await findRecord(token);
  if (!record) return null;
  return {
    token,
    input: record.input,
    campaignId: record.campaign_id ?? "",
    product: record.product ?? null,
    competitors: record.competitors ?? null,
    campaigns: record.campaigns ?? null,
    leads: record.leads ?? null,
    proposals: record.proposals ?? null,
  };
}

export async function updateRun(token: string, patch: Partial<Omit<ExploreRun, "token" | "input">>): Promise<void> {
  const record = await findRecord(token);
  if (!record) throw new Error("Explore run not found.");
  const { campaignId, ...rest } = patch;
  const body: Record<string, unknown> = { ...rest };
  if (campaignId !== undefined) body.campaign_id = campaignId;
  if (Object.keys(body).length === 0) return;
  await pocketBaseFetch(`/api/collections/${COLLECTION}/records/${encodeURIComponent(record.id)}`, { method: "PATCH", body: JSON.stringify(body) });
}

export async function countRunsByIp(ipHash: string, sinceIso: string): Promise<number> {
  // PocketBase guarda fechas como "YYYY-MM-DD HH:MM:SS.sssZ"; la "T" del ISO rompe la comparación de strings.
  const since = new Date(sinceIso).toISOString().replace("T", " ");
  const list = await pocketBaseFetch<List<unknown>>(listPath({ filter: `ip_hash = ${quote(ipHash)} && created >= ${quote(since)}`, perPage: "1", fields: "id" }));
  return list.totalItems ?? 0;
}

const httpUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
};

/** ExploreLead → campos de un registro de leads (mismo shape que business-search). */
function toLeadRecord(lead: ExploreLead, createdAt: string) {
  return {
    name: lead.name.slice(0, 255),
    maps_url: httpUrl(lead.maps_url),
    address: lead.address.slice(0, 1000),
    review_count: lead.review_count.slice(0, 30),
    average_rating: lead.average_rating.slice(0, 30),
    phone: (lead.phone || lead.whatsapp).slice(0, 100),
    email: lead.email.slice(0, 500),
    website: httpUrl(lead.website),
    category: lead.category.slice(0, 500),
    credit_cost: 0,
    ...(lead.whatsapp ? { whatsapp_status: "verified" } : {}),
    created_at: createdAt,
  };
}

/** Pasa los leads de la corrida a un lote del usuario. Una sola vez por corrida; null si no hay nada que reclamar. */
export async function claimRun(token: string, userId: string): Promise<{ batchId: string } | null> {
  const record = await findRecord(token);
  const leads = record?.leads ?? [];
  if (!record || record.claimed_by || leads.length === 0) return null;

  const runPath = `/api/collections/${COLLECTION}/records/${encodeURIComponent(record.id)}`;
  // Marca primero: una segunda llamada concurrente ve claimed_by y no duplica el lote.
  const claimedAt = new Date().toISOString();
  await pocketBaseFetch(runPath, { method: "PATCH", body: JSON.stringify({ claimed_by: userId, claimed_at: claimedAt }) });

  let batchId = "";
  try {
    const campaign = record.campaigns?.find((item) => item.id === record.campaign_id);
    const keywords = campaign?.keywords.length ? campaign.keywords : [campaign?.name || record.product?.name || "explorar"];
    const items = leads.slice(0, 150);
    const batch = await pocketBaseFetch<{ id: string }>("/api/collections/lead_batches/records", {
      method: "POST",
      body: JSON.stringify({
        keywords,
        country: (record.product?.country || record.product?.location || "-").slice(0, 100),
        user: userId,
        requested_count: items.length,
        result_count: 0,
        status: "running",
        created_at: claimedAt,
      }),
    });
    batchId = batch.id;
    const { created } = await createLeadRecords(batchId, items.map((lead) => toLeadRecord(lead, claimedAt)));
    await pocketBaseFetch(`/api/collections/lead_batches/records/${encodeURIComponent(batchId)}`, {
      method: "PATCH",
      body: JSON.stringify({ result_count: created, status: created === items.length ? "completed" : created > 0 ? "partial" : "failed" }),
    });
    return { batchId };
  } catch (error) {
    // Sin lote creado se libera la corrida para reintentar; con lote creado queda reclamada (nunca dos lotes).
    if (!batchId) await pocketBaseFetch(runPath, { method: "PATCH", body: JSON.stringify({ claimed_by: "", claimed_at: "" }) }).catch(() => {});
    throw error;
  }
}
