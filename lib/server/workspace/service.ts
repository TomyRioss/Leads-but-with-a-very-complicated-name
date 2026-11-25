import "server-only";
import { createHash } from "node:crypto";
import type { AppUser } from "@/lib/server/auth";
import type { ApiResult } from "@/lib/server/api-result";
import type { Locale } from "@/lib/server/locale";
import type { Proposal } from "@/lib/workspace/types";
import { runBusinessSearch } from "@/lib/server/business-search";
import { hasGmail } from "@/lib/server/google-connections";
import { GmailNotConnectedError, GmailQuotaError, isValidEmail, sendGmail } from "@/lib/server/google-gmail";
import { reserveGmailDailyUsage } from "@/lib/server/gmail-daily-usage";
import { recordLeadContact } from "@/lib/server/lead-suite";
import { whatsAppMonthlyUsage } from "@/lib/server/scheduled-messages";
import { enqueueWhatsApp, getLeadWhatsApp, getWhatsAppMessageStatus, isWhatsAppConnected, whatsAppDigits, WhatsAppNotConnectedError } from "@/lib/server/whatsapp";
import { isEditableStatus, isoToPb, isRecordId, parseProposalPatch, parseSearchCount, searchKeywords } from "@/lib/server/workspace/mapping";
import { appendCampaignBatch, getBusiness, getCampaign, getLeadEmail, getProposal, patchProposal } from "@/lib/server/workspace/repository";

// Casos de uso de "Mis campañas / Mis propuestas" que coordinan otros módulos (búsqueda, Gmail, WhatsApp).

export type Outcome<T> = { ok: true; value: T } | { ok: false; status: number; code: string };
const fail = (status: number, code: string): { ok: false; status: number; code: string } => ({ ok: false, status, code });

/** "Buscar más leads" de una campaña: misma búsqueda (y cobro) que /api/search con keywords + país del negocio. */
export async function searchCampaignLeads(user: Pick<AppUser, "id">, campaignId: string, rawBody: unknown, locale: Locale): Promise<ApiResult> {
  if (!isRecordId(campaignId)) return { status: 404, body: { error: "not_found" } };
  const count = parseSearchCount(rawBody && typeof rawBody === "object" ? (rawBody as { count?: unknown }).count : undefined);
  if (count === null) return { status: 400, body: { error: "invalid_request" } };
  const campaign = await getCampaign(user.id, campaignId);
  if (!campaign) return { status: 404, body: { error: "not_found" } };
  const business = await getBusiness(user.id, campaign.businessId);
  if (!business) return { status: 404, body: { error: "not_found" } };

  const result = await runBusinessSearch(user, { keywords: searchKeywords(campaign), country: business.country || business.location, count }, { locale });
  const batchId = result.status === 200 && typeof result.body.batchId === "string" ? result.body.batchId : "";
  if (!batchId) return result; // Error de la búsqueda tal cual /api/search (mensaje, credits, required).
  await appendCampaignBatch(campaign.id, batchId);
  const created = Array.isArray(result.body.leads) ? result.body.leads.length : 0;
  return { status: 200, body: { batchId, created, credits: result.body.credits }, refreshSession: true };
}

export async function editProposal(userId: string, id: string, rawBody: unknown): Promise<Outcome<Proposal>> {
  const proposal = isRecordId(id) ? await getProposal(userId, id) : null;
  if (!proposal) return fail(404, "not_found");
  if (!isEditableStatus(proposal.status)) return fail(409, "already_sent");
  const patch = parseProposalPatch(rawBody, proposal.channel);
  if (!patch) return fail(400, "invalid_request");
  return { ok: true, value: await patchProposal(proposal.id, patch) };
}

// Un envío por propuesta a la vez en esta instancia (ponytail: lock en memoria como rate-limit; WhatsApp además deduplica por ref).
const sending = new Set<string>();
const emailLog = (subject: string, body: string) => `${subject}\n\n${body}`.slice(0, 4000); // mismo formato que leadtita-tools
const SEND_STATUS: Record<string, number> = { needs_whatsapp: 409, needs_gmail: 409, recipient_missing: 409, limit_reached: 429, send_failed: 502 };

/** Envía la propuesta por la integración real. Éxito → sent + sent_at; fallo → failed + código (la propuesta sigue editable). */
export async function sendProposal(userId: string, id: string): Promise<Outcome<Proposal>> {
  const proposal = isRecordId(id) ? await getProposal(userId, id) : null;
  if (!proposal) return fail(404, "not_found");
  if (proposal.status === "sent" || sending.has(proposal.id)) return fail(409, "already_sent");
  sending.add(proposal.id);
  try {
    const code = proposal.channel === "gmail" ? await deliverGmail(userId, proposal) : await deliverWhatsApp(userId, proposal);
    if (code) {
      await patchProposal(proposal.id, { status: "failed", error: code });
      return fail(SEND_STATUS[code] ?? 502, code);
    }
    return { ok: true, value: await patchProposal(proposal.id, { status: "sent", error: "", sent_at: isoToPb(new Date().toISOString()) }) };
  } finally {
    sending.delete(proposal.id);
  }
}

/** "" = enviado; si no, el código de error del contrato. */
async function deliverGmail(userId: string, proposal: Proposal): Promise<string> {
  if (!await hasGmail(userId)) return "needs_gmail";
  const to = isValidEmail(proposal.to) ? proposal.to : proposal.leadId ? await getLeadEmail(userId, proposal.leadId) : "";
  if (!to || !isValidEmail(to)) return "recipient_missing";
  const quota = await reserveGmailDailyUsage(userId, 1);
  if (!quota.granted) return "limit_reached";
  try {
    await sendGmail(userId, { to, subject: proposal.subject, text: proposal.body });
  } catch (error) {
    await quota.settle(0).catch(() => undefined);
    if (error instanceof GmailNotConnectedError) return "needs_gmail";
    if (error instanceof GmailQuotaError) return "limit_reached";
    console.error("Proposal Gmail send failed", error instanceof Error ? error.name : "unknown");
    return "send_failed";
  }
  if (proposal.leadId) {
    await recordLeadContact(userId, { leadId: proposal.leadId, channel: "email", message: emailLog(proposal.subject, proposal.body), contactedAt: new Date().toISOString() }).catch(() => undefined);
  }
  return "";
}

/** Cola del worker Baileys (espaciado, cupo mensual). El callback "sent" del worker registra el contacto en Lead Suite. */
async function deliverWhatsApp(userId: string, proposal: Proposal): Promise<string> {
  if (!await isWhatsAppConnected(userId)) return "needs_whatsapp";
  // El worker exige un lead (su callback registra el contacto): sin lead no hay destinatario válido.
  if (!proposal.leadId) return "recipient_missing";
  // /explorar guarda el destinatario como dígitos E.164 sin "+".
  const phone = whatsAppDigits(/^\d{8,15}$/.test(proposal.to) ? `+${proposal.to}` : proposal.to) || await getLeadWhatsApp(userId, proposal.leadId);
  if (!phone) return "recipient_missing";
  const quota = await whatsAppMonthlyUsage(userId).catch(() => null);
  if (quota && quota.remaining < 1) return "limit_reached";
  // Ref estable por propuesta: un reintento llega al worker como duplicado y no se manda dos veces.
  const ref = createHash("sha256").update(`proposal:${userId}:${proposal.id}`).digest("hex").slice(0, 40);
  try {
    const result = await enqueueWhatsApp(userId, [{ ref, leadId: proposal.leadId, phone, text: proposal.body }]);
    if (result.invalid.length) return "recipient_missing";
    if (result.queued.includes(ref)) return "";
    if (!result.duplicates.includes(ref)) return "send_failed";
    // Ya estaba en el worker: solo cuenta como enviado si no falló allá.
    return (await getWhatsAppMessageStatus(userId, ref)).status === "failed" ? "send_failed" : "";
  } catch (error) {
    if (error instanceof WhatsAppNotConnectedError) return "needs_whatsapp";
    console.error("Proposal WhatsApp send failed", error instanceof Error ? error.name : "unknown");
    return "send_failed";
  }
}
