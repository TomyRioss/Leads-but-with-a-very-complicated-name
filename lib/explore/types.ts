// Contrato compartido del flujo público /explorar (landing → 5 pasos).
// Servidor (lib/server/explore, app/api/explore) y cliente (app/[locale]/explorar) usan solo estos tipos.

export type ExploreInput =
  | { mode: "text"; description: string }
  | { mode: "web"; url: string }
  | { mode: "services"; offer: string; idealCustomer: string; markets: string };

export type ExploreStep = "research" | "competitors" | "campaigns" | "leads" | "proposals";
export const EXPLORE_STEPS: readonly ExploreStep[] = ["research", "competitors", "campaigns", "leads", "proposals"];

/** Paso 1: ficha del producto. */
export type ExploreProduct = {
  name: string;
  domain: string; // "" si el input fue texto/servicios
  summary: string; // 1–2 oraciones
  location: string; // país o región principal, "" si no se sabe
  country: string; // nombre de país compatible con resolveLocation, "" si no se sabe
};

/** Paso 2: competidores. */
export type ExploreCompetitors = {
  headline: string; // "No-code small business pages"
  valueProps: string[]; // 3
  buyerSearches: string[]; // 3 búsquedas típicas del comprador
  competitors: { name: string; domain: string }[]; // 4–8
};

/** Paso 3: campañas (rubros objetivo). Sin cantidad de empresas: solo afinidad. */
export type ExploreCampaign = {
  id: string; // slug
  name: string; // "Restaurantes"
  icon: "store" | "utensils" | "graduation" | "map-pin" | "briefcase" | "heart-pulse" | "wrench" | "building" | "shopping-cart" | "sparkles";
  fit: number; // 0–100, % de afinidad con su mercado
  pitch: string; // una oración; palabras clave entre **dobles asteriscos**
  pain: string;
  criteria: string[]; // 3
  examples: string[]; // 2–3 tipos de negocio
  keywords: string[]; // 1–3 keywords para Google Maps (en idioma del país)
};

/** Paso 4: lead mínimo para la demo (subset de Lead). */
export type ExploreLead = {
  id: string;
  name: string;
  category: string;
  description?: string; // del perfil o IA; ausente en corridas viejas
  address: string;
  country_code?: string; // ISO 3166-1 alfa-2, ausente en corridas viejas
  city?: string;
  district?: string;
  phone: string;
  whatsapp: string; // número si tiene WhatsApp, "" si no
  email: string;
  website: string;
  maps_url: string;
  average_rating: string;
  review_count: string;
};

/** Paso 5: propuestas. */
export type ExploreProposal = {
  leadId: string;
  channel: "whatsapp" | "gmail";
  to: string; // teléfono o email
  subject: string; // "" para whatsapp
  body: string;
};

export type ExploreRun = {
  token: string; // secreto del navegador, nunca se guarda en claro
  input: ExploreInput;
  campaignId: string; // campaña elegida para buscar leads ("" hasta el paso 3)
  product: ExploreProduct | null;
  competitors: ExploreCompetitors | null;
  campaigns: ExploreCampaign[] | null;
  leads: ExploreLead[] | null;
  proposals: ExploreProposal[] | null;
};

export const EXPLORE_LEAD_COUNT = 50;
export const EXPLORE_PROPOSAL_COUNT = 10;
export const EXPLORE_MIN_MINORITY_CHANNEL = 2;
export const EXPLORE_RUNS_PER_IP_PER_DAY = 3;
export const EXPLORE_TOKEN_COOKIE = "leadta_explore";
