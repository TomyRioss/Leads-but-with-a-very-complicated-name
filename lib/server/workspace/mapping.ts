// Reglas puras de "Mis negocios / Mis campañas / Mis propuestas": registro PocketBase ↔ contrato, validación y límites.
// Sin imports con costo en runtime: el selfcheck lo corre con node plano.
import type { ExploreCampaign, ExploreCompetitors, ExploreProduct, ExploreProposal } from "@/lib/explore/types";
import type { Business, Proposal, ProposalChannel, ProposalStatus, SalesCampaign } from "@/lib/workspace/types";

export const RECORD_ID = /^[a-zA-Z0-9]{15}$/;
export const WORKSPACE_LIMITS = {
  businesses: 100,
  campaigns: 200,
  proposals: 200,
  campaignLeads: 500,
  subject: 120,
  whatsappBody: 1500,
  gmailBody: 5000,
  keywords: 10,
  keyword: 120,
} as const;
export const CAMPAIGN_SEARCH_COUNTS = [5, 10, 25, 50, 75, 100, 125, 150] as const;
export const DEFAULT_CAMPAIGN_SEARCH_COUNT = 25;

const ICONS = new Set<ExploreCampaign["icon"]>(["store", "utensils", "graduation", "map-pin", "briefcase", "heart-pulse", "wrench", "building", "shopping-cart", "sparkles"]);

export const isRecordId = (value: unknown): value is string => typeof value === "string" && RECORD_ID.test(value);
/** Literal seguro para filtros PocketBase (escapa comillas y barras). */
export const quote = (value: string) => JSON.stringify(value);

const text = (value: unknown, max = 5000) => (typeof value === "string" ? value.slice(0, max) : "");
const strings = (value: unknown, maxItems = 20, maxLength = 300) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => item.slice(0, maxLength)).slice(0, maxItems) : [];
const competitorList = (value: unknown) =>
  Array.isArray(value)
    ? value.flatMap((item) => (item && typeof item === "object" ? [{ name: text((item as { name?: unknown }).name, 200), domain: text((item as { domain?: unknown }).domain, 255) }] : [])).slice(0, 20)
    : [];

/** "YYYY-MM-DD HH:MM:SS.sssZ" de PocketBase → ISO; "" si vacío o inválido. */
export function pbToIso(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  const date = new Date(value.replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}
export const isoToPb = (iso: string) => iso.replace("T", " ");

export type BusinessRow = { id: string; name?: string; domain?: string; summary?: string; location?: string; country?: string; headline?: string; value_props?: unknown; buyer_searches?: unknown; competitors?: unknown; created?: string };
export type CampaignRow = { id: string; business: string; name?: string; icon?: string; fit?: number; pitch?: string; pain?: string; criteria?: unknown; examples?: unknown; keywords?: unknown; batches?: unknown; created?: string };
export type ProposalRow = { id: string; business: string; campaign: string; lead?: string; lead_name?: string; channel?: string; to?: string; subject?: string; body?: string; status?: string; error?: string; sent_at?: string; created?: string };

export function toBusiness(row: BusinessRow): Business {
  return {
    id: row.id,
    name: text(row.name, 200),
    domain: text(row.domain, 255),
    summary: text(row.summary, 2000),
    location: text(row.location, 200),
    country: text(row.country, 100),
    headline: text(row.headline, 300),
    valueProps: strings(row.value_props),
    buyerSearches: strings(row.buyer_searches),
    competitors: competitorList(row.competitors),
    created: pbToIso(row.created),
  };
}

export const campaignBatchIds = (row: Pick<CampaignRow, "batches">) => (Array.isArray(row.batches) ? row.batches.filter(isRecordId) : []);

export function toSalesCampaign(row: CampaignRow, resultCounts: ReadonlyMap<string, number>): SalesCampaign {
  const batchIds = campaignBatchIds(row);
  const icon = ICONS.has(row.icon as ExploreCampaign["icon"]) ? (row.icon as ExploreCampaign["icon"]) : "sparkles";
  return {
    id: row.id,
    businessId: row.business,
    name: text(row.name, 200),
    icon,
    fit: Math.max(0, Math.min(100, Math.round(Number(row.fit) || 0))),
    pitch: text(row.pitch, 1000),
    pain: text(row.pain, 1000),
    criteria: strings(row.criteria),
    examples: strings(row.examples),
    keywords: strings(row.keywords, WORKSPACE_LIMITS.keywords, WORKSPACE_LIMITS.keyword),
    batchIds,
    leadCount: batchIds.reduce((sum, id) => sum + (resultCounts.get(id) ?? 0), 0),
    created: pbToIso(row.created),
  };
}

const channelOf = (value: unknown): ProposalChannel => (value === "gmail" ? "gmail" : "whatsapp");
const statusOf = (value: unknown): ProposalStatus => (value === "sent" || value === "failed" ? value : "draft");

export function toProposal(row: ProposalRow): Proposal {
  return {
    id: row.id,
    businessId: row.business,
    campaignId: row.campaign,
    leadId: text(row.lead, 15),
    leadName: text(row.lead_name, 255),
    channel: channelOf(row.channel),
    to: text(row.to, 500),
    subject: text(row.subject, 200),
    body: text(row.body, 5000),
    status: statusOf(row.status),
    error: text(row.error, 60),
    sentAt: pbToIso(row.sent_at),
    created: pbToIso(row.created),
  };
}

export const bodyLimit = (channel: ProposalChannel) => (channel === "gmail" ? WORKSPACE_LIMITS.gmailBody : WORKSPACE_LIMITS.whatsappBody);
export const isEditableStatus = (status: ProposalStatus) => status === "draft" || status === "failed";

/** PATCH {subject?, body?}: null si es inválido. WhatsApp no lleva asunto. Sin cambios = null. */
export function parseProposalPatch(input: unknown, channel: ProposalChannel): { subject?: string; body?: string } | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const raw = input as { subject?: unknown; body?: unknown };
  const patch: { subject?: string; body?: string } = {};
  if (raw.subject !== undefined) {
    if (typeof raw.subject !== "string") return null;
    const subject = raw.subject.trim();
    if (channel === "whatsapp" ? subject !== "" : !subject || subject.length > WORKSPACE_LIMITS.subject || /[\r\n]/.test(subject)) return null;
    patch.subject = subject;
  }
  if (raw.body !== undefined) {
    if (typeof raw.body !== "string") return null;
    const body = raw.body.trim();
    if (!body || body.length > bodyLimit(channel)) return null;
    patch.body = body;
  }
  return Object.keys(patch).length ? patch : null;
}

/** Cantidad para "buscar más leads": la del body si es válida, si no la default. null = inválida. */
export function parseSearchCount(value: unknown): number | null {
  if (value === undefined || value === null) return DEFAULT_CAMPAIGN_SEARCH_COUNT;
  return typeof value === "number" && (CAMPAIGN_SEARCH_COUNTS as readonly number[]).includes(value) ? value : null;
}

/** Keywords de la campaña para Google Maps: únicas, no vacías, acotadas. Sin keywords cae al nombre. */
export function searchKeywords(campaign: Pick<SalesCampaign, "keywords" | "name">): string[] {
  const list = [...new Set(campaign.keywords.map((keyword) => keyword.trim()).filter(Boolean))].slice(0, WORKSPACE_LIMITS.keywords);
  return list.length ? list : [campaign.name.trim().slice(0, WORKSPACE_LIMITS.keyword)].filter(Boolean);
}

// ---------- /explorar → registros (claimRun) ----------

export function businessRecord(userId: string, runId: string, product: ExploreProduct, competitors: ExploreCompetitors | null) {
  return {
    user: userId,
    landing_run: runId,
    name: text(product.name, 200) || "-",
    domain: text(product.domain, 255),
    summary: text(product.summary, 2000),
    location: text(product.location, 200),
    country: text(product.country, 100),
    headline: text(competitors?.headline, 300),
    value_props: strings(competitors?.valueProps),
    buyer_searches: strings(competitors?.buyerSearches),
    competitors: competitorList(competitors?.competitors),
  };
}

export function campaignRecord(userId: string, businessId: string, campaign: ExploreCampaign, batchIds: string[]) {
  return {
    user: userId,
    business: businessId,
    name: text(campaign.name, 200) || "-",
    icon: ICONS.has(campaign.icon) ? campaign.icon : "sparkles",
    fit: Math.max(0, Math.min(100, Math.round(Number(campaign.fit) || 0))),
    pitch: text(campaign.pitch, 1000),
    pain: text(campaign.pain, 1000),
    criteria: strings(campaign.criteria),
    examples: strings(campaign.examples),
    keywords: strings(campaign.keywords, WORKSPACE_LIMITS.keywords, WORKSPACE_LIMITS.keyword),
    batches: batchIds.filter(isRecordId),
  };
}

/** Propuesta de la corrida → registro draft. `leadIds`: id de lead de /explorar → id creado en "leads". */
export function proposalRecord(
  ids: { userId: string; businessId: string; campaignId: string },
  proposal: ExploreProposal,
  leadIds: ReadonlyMap<string, string>,
  leadNames: ReadonlyMap<string, string>,
) {
  const channel = channelOf(proposal.channel);
  return {
    user: ids.userId,
    business: ids.businessId,
    campaign: ids.campaignId,
    lead: leadIds.get(proposal.leadId) ?? "",
    lead_name: text(leadNames.get(proposal.leadId), 255),
    channel,
    to: text(proposal.to, 500),
    subject: channel === "gmail" ? text(proposal.subject, 200) : "",
    body: text(proposal.body, bodyLimit(channel)),
    status: "draft" as const,
    error: "",
  };
}
