// Contrato de "Mis negocios / Mis campañas / Mis propuestas": lo que una corrida de /explorar deja en la cuenta.
// Servidor (lib/server/workspace, app/api/{businesses,sales-campaigns,proposals}) y cliente (app/[locale]/{negocios,campanas,propuestas}) usan solo estos tipos.
import type { ExploreCampaign } from "@/lib/explore/types";

/** Un negocio del usuario: ficha del producto (paso 1) + mercado y competidores (paso 2). */
export type Business = {
  id: string;
  name: string;
  domain: string; // "" si vino de texto
  summary: string;
  location: string;
  country: string;
  headline: string;
  valueProps: string[];
  buyerSearches: string[];
  competitors: { name: string; domain: string }[];
  created: string; // ISO
  // Onboarding (migración 1795500000). Opcionales: negocios viejos o de /explorar no los tienen.
  markets?: BusinessMarket[]; // paso 2
  businessTypes?: string[]; // paso 2: rubros a los que vende
  offerConfirmed?: boolean; // paso 3
  marketsConfirmed?: boolean; // paso 3
  channels?: ProposalChannel[]; // paso 5
  onboardingStep?: OnboardingStep; // paso donde quedó; "done" al terminar
};

export type BusinessMarket = { country: string; region: string }; // region "" = todo el país

/** Pasos del onboarding de un negocio, en orden. "done" = completo. */
export const ONBOARDING_STEPS = ["company", "customers", "confirm", "plan", "channels", "capacity"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number] | "done";

// Varios negocios por cuenta, uno activo (users.active_business). El servidor resuelve siempre el activo; nunca confía en un id del cliente sin verificar que sea del usuario.
//   GET   /api/businesses                       → { businesses: Business[], activeId: string } ("" si no hay activo)
//   PATCH /api/businesses/active {businessId}   → { activeId } | 404 not_found (no es del usuario)
// Onboarding (todas privadas, 401 sin sesión):
//   POST  /api/onboarding {mode:"web",url} | {mode:"text",description}
//         → { business } (investiga con IA = pasos 1-2 de /explorar, crea el negocio en paso "company"; si el usuario no tiene activo, queda activo)
//         errores: invalid_request 400 | rate_limited 429 | research_failed 502
//   GET   /api/onboarding/<id>                  → { business } | 404 not_found
//   PATCH /api/onboarding/<id> {step, data}     → { business } (guarda ese paso y avanza onboardingStep al siguiente; se puede volver a un paso anterior ya hecho)
//         company   {name, summary, competitors[]}
//         customers {markets[], businessTypes[]}          (≥1 market)
//         confirm   {offerConfirmed:true, marketsConfirmed:true} (ambos obligatorios)
//         plan      {}
//         channels  {channels[]}                          (≥1)
//         capacity  {}  → onboardingStep "done" y el negocio queda activo
//         errores: invalid_request 400 | step_locked 409 (paso posterior al actual) | not_found 404

/** Campaña de venta de un negocio (paso 3). No confundir con la colección "campaigns" (promos de descuento). */
export type SalesCampaign = {
  id: string;
  businessId: string;
  name: string;
  icon: ExploreCampaign["icon"];
  fit: number; // 0–100
  pitch: string; // **negritas** permitidas
  pain: string;
  criteria: string[];
  examples: string[];
  keywords: string[]; // búsqueda en Google Maps
  batchIds: string[]; // lotes de leads (lead_batches) de esta campaña
  leadCount: number; // suma de result_count de sus lotes
  created: string;
};

export type ProposalChannel = "whatsapp" | "gmail";
export type ProposalStatus = "draft" | "sent" | "failed";

/** Propuesta para un lead de una campaña (paso 5). */
export type Proposal = {
  id: string;
  businessId: string;
  campaignId: string;
  leadId: string; // registro en "leads"
  leadName: string;
  channel: ProposalChannel;
  to: string; // teléfono o email
  subject: string; // "" en WhatsApp
  body: string;
  status: ProposalStatus;
  error: string; // código del último fallo de envío, "" si no hubo
  sentAt: string; // ISO, "" si no se envió
  created: string;
};

// API (todas privadas: 401 {error:"unauthorized"} sin sesión; errores como {error: código}; solo datos del usuario):
//   GET   /api/businesses                              → { businesses: Business[] } (más nuevo primero)
//   GET   /api/sales-campaigns?business=<id>           → { campaigns: SalesCampaign[] } (sin param: todas; orden fit desc)
//   GET   /api/sales-campaigns/<id>/leads              → { leads: Lead[] } (lib/types Lead; tope 500)
//   POST  /api/sales-campaigns/<id>/search {count?}    → { batchId, created, credits } (busca más leads con keywords+país; cobra créditos como /api/search)
//   GET   /api/proposals?campaign=<id>&business=<id>   → { proposals: Proposal[] } (params opcionales)
//   PATCH /api/proposals/<id> {subject?, body?}        → { proposal: Proposal } (solo status "draft" o "failed")
//   POST  /api/proposals/<id>/send                     → { proposal: Proposal } (status "sent");
//         errores: needs_whatsapp | needs_gmail | recipient_missing | limit_reached | already_sent | send_failed
