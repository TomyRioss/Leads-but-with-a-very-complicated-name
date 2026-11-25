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
};

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
