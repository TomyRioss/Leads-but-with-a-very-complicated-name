// Reglas puras de "Mis negocios / Mis campañas / Mis propuestas": registro PocketBase ↔ contrato, validación y límites.
// Sin imports con costo en runtime: el selfcheck lo corre con node plano.
import type { ExploreCampaign, ExploreCompetitors, ExploreProduct, ExploreProposal } from "@/lib/explore/types";
import type { Business, BusinessMarket, ONBOARDING_STEPS, OnboardingStep, Proposal, ProposalChannel, ProposalStatus, SalesCampaign } from "@/lib/workspace/types";

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

export type BusinessRow = {
  id: string; name?: string; domain?: string; summary?: string; location?: string; country?: string; headline?: string;
  value_props?: unknown; buyer_searches?: unknown; competitors?: unknown; created?: string;
  markets?: unknown; business_types?: unknown; offer_confirmed_at?: string; markets_confirmed_at?: string; channels?: unknown; onboarding_step?: string;
};
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
    markets: marketList(row.markets),
    businessTypes: businessTypeList(row.business_types),
    offerConfirmed: !!row.offer_confirmed_at,
    marketsConfirmed: !!row.markets_confirmed_at,
    channels: channelList(row.channels),
    onboardingStep: storedStep(row),
  };
}

// ---------- Onboarding de un negocio ----------

// Mismo orden que ONBOARDING_STEPS (el satisfies falla si divergen); copia local porque el selfcheck no resuelve "@/".
const STEP_ORDER = ["company", "customers", "confirm", "plan", "channels", "capacity"] as const satisfies typeof ONBOARDING_STEPS;
export type EditableStep = (typeof STEP_ORDER)[number];
export const ONBOARDING_LIMITS = { markets: 10, place: 100, businessTypes: 12, businessType: 60, name: 200, summary: 2000, competitors: 20, competitorDomain: 255 } as const;
const CHANNELS = new Set<ProposalChannel>(["whatsapp", "gmail"]);

const isPlainObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export const isEditableStep = (value: unknown): value is EditableStep => typeof value === "string" && (STEP_ORDER as readonly string[]).includes(value);
const isStep = (value: unknown): value is OnboardingStep => value === "done" || isEditableStep(value);
/** Posición del paso; "done" va después de todos. */
const stepIndex = (step: OnboardingStep) => (step === "done" ? STEP_ORDER.length : STEP_ORDER.indexOf(step));

/** Paso guardado si es válido; si falta: "confirm" para negocios de /explorar (ya traen ficha y competidores), si no "company". */
function storedStep(row: Pick<BusinessRow, "onboarding_step" | "summary">): OnboardingStep {
  if (isStep(row.onboarding_step)) return row.onboarding_step;
  return typeof row.summary === "string" && row.summary.trim() ? "confirm" : "company";
}

const marketList = (value: unknown): BusinessMarket[] =>
  Array.isArray(value)
    ? value.flatMap((item) => {
        if (!isPlainObject(item)) return [];
        const country = text(item.country, ONBOARDING_LIMITS.place).trim();
        return country ? [{ country, region: text(item.region, ONBOARDING_LIMITS.place).trim() }] : [];
      }).slice(0, ONBOARDING_LIMITS.markets)
    : [];
const businessTypeList = (value: unknown) => strings(value, ONBOARDING_LIMITS.businessTypes, ONBOARDING_LIMITS.businessType).map((item) => item.trim()).filter(Boolean);
const channelList = (value: unknown): ProposalChannel[] =>
  Array.isArray(value) ? [...new Set(value.filter((item): item is ProposalChannel => CHANNELS.has(item as ProposalChannel)))] : [];

/** Solo se edita un paso ya alcanzado (o el actual); nunca uno posterior. */
export function canEditStep(current: OnboardingStep, step: unknown): step is EditableStep {
  return isEditableStep(step) && stepIndex(step) <= stepIndex(current);
}

/** Paso siguiente a `step`; después de "capacity" viene "done". */
export function nextStep(step: EditableStep): OnboardingStep {
  return STEP_ORDER[STEP_ORDER.indexOf(step) + 1] ?? "done";
}

/** El más avanzado de los dos: volver a un paso anterior no retrocede el progreso. */
export const furthestStep = (a: OnboardingStep, b: OnboardingStep): OnboardingStep => (stepIndex(a) >= stepIndex(b) ? a : b);

// Validadores estrictos: fuera de rango = inválido (null); nunca se recorta en silencio lo que escribió el usuario.
const requiredText = (value: unknown, max: number) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : null;
};
const optionalText = (value: unknown, max: number) => {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : null;
};
/** Cada ítem por `parse`; null si no es array, si hay uno inválido o si pasa de `max`. */
function parseList<T>(value: unknown, max: number, parse: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  const out: T[] = [];
  for (const item of value) {
    const parsed = parse(item);
    if (parsed === null) return null;
    out.push(parsed);
  }
  return out;
}

function parseCompetitor(item: unknown) {
  if (!isPlainObject(item)) return null;
  const name = requiredText(item.name, ONBOARDING_LIMITS.name);
  const domain = optionalText(item.domain, ONBOARDING_LIMITS.competitorDomain);
  return name !== null && domain !== null ? { name, domain } : null;
}

function parseMarket(item: unknown): BusinessMarket | null {
  if (!isPlainObject(item)) return null;
  const country = requiredText(item.country, ONBOARDING_LIMITS.place);
  const region = optionalText(item.region, ONBOARDING_LIMITS.place);
  return country !== null && region !== null ? { country, region } : null;
}

/** Sin repetidos (sin distinguir mayúsculas); se queda el primero. */
function dedupe<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = key(item).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * PATCH de un paso del onboarding → campos de PocketBase, o null si el payload es inválido.
 * `now` fecha las confirmaciones del paso "confirm". "plan" y "capacity" no guardan datos ({}).
 */
export function parseOnboardingStep(step: unknown, data: unknown, now = new Date()): Record<string, unknown> | null {
  if (!isEditableStep(step)) return null;
  const raw = data === undefined || data === null ? {} : data;
  if (!isPlainObject(raw)) return null;
  switch (step) {
    case "company": {
      const name = requiredText(raw.name, ONBOARDING_LIMITS.name);
      const summary = optionalText(raw.summary, ONBOARDING_LIMITS.summary);
      const competitors = parseList(raw.competitors ?? [], ONBOARDING_LIMITS.competitors, parseCompetitor);
      if (name === null || summary === null || competitors === null) return null;
      return { name, summary, competitors: dedupe(competitors, (item) => item.domain || item.name) };
    }
    case "customers": {
      const markets = parseList(raw.markets, ONBOARDING_LIMITS.markets, parseMarket);
      const businessTypes = parseList(raw.businessTypes ?? [], ONBOARDING_LIMITS.businessTypes, (item) => requiredText(item, ONBOARDING_LIMITS.businessType));
      if (!markets?.length || businessTypes === null) return null;
      return { markets: dedupe(markets, (item) => `${item.country}|${item.region}`), business_types: dedupe(businessTypes, (item) => item) };
    }
    case "confirm": {
      if (raw.offerConfirmed !== true || raw.marketsConfirmed !== true) return null;
      const at = isoToPb(now.toISOString());
      return { offer_confirmed_at: at, markets_confirmed_at: at };
    }
    case "channels": {
      const channels = parseList(raw.channels, CHANNELS.size, (item) => (CHANNELS.has(item as ProposalChannel) ? (item as ProposalChannel) : null));
      if (!channels?.length) return null;
      return { channels: [...new Set(channels)] };
    }
    case "plan":
    case "capacity":
      return {};
  }
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

/** Negocio nuevo del onboarding: la investigación de IA (pasos 1-2 de /explorar) sin corrida, en el paso "company". */
export function onboardingBusinessRecord(userId: string, product: ExploreProduct, competitors: ExploreCompetitors) {
  return { ...businessRecord(userId, "", product, competitors), onboarding_step: "company" satisfies OnboardingStep };
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
