import { NextResponse } from "next/server";
import { deleteLeadContact, getLeadContact, getUserLead, listLeadContacts, recordLeadContact } from "@/lib/server/lead-suite";
import type { LeadContact, LeadMatch } from "@/lib/lead-suite";
import { errorTranslator } from "@/lib/server/locale";
import { isId, parseContactFields, parseMeetingRequest, requireUser, scheduleMeeting, serverError } from "./validate";

/** Historial de contactos de un lead del usuario (más nuevo primero). */
export async function GET(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  const t = errorTranslator(request);
  const leadId = new URL(request.url).searchParams.get("leadId");
  if (!isId(leadId)) return NextResponse.json({ error: t("generic") }, { status: 400 });
  try {
    if (!(await getUserLead(auth.userId, leadId))) return NextResponse.json({ error: t("generic") }, { status: 404 });
    const { items } = await listLeadContacts(auth.userId, { leadId, perPage: 50 });
    return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return serverError(request, "contact history", error);
  }
}

/** Registro directo de un contacto (formulario de "Mis leads"), sin pasar por el chat. Gratis. */
export async function POST(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  const t = errorTranslator(request);
  const body = await request.json().catch(() => null) as { leadId?: unknown } | null;
  const fields = parseContactFields(body, false);
  const meeting = parseMeetingRequest(body);
  if (!fields || !isId(body?.leadId) || meeting === "invalid" || (meeting && fields.status !== "meeting")) return NextResponse.json({ error: t("generic") }, { status: 400 });
  const leadId = body.leadId;
  try {
    if (!(await getUserLead(auth.userId, leadId))) return NextResponse.json({ error: t("generic") }, { status: 404 });
    const contact = await recordLeadContact(auth.userId, {
      leadId,
      channel: fields.channel!,
      contactedAt: fields.contactedAt!,
      status: fields.status,
      message: fields.message ?? "",
      notes: fields.notes ?? "",
    });
    // "Agendar en Google Calendar": the contact stays saved even if the event can't be created.
    const scheduled = meeting ? await scheduleMeeting(auth.userId, contact, meeting) : { contact };
    const lead = await getUserLead(auth.userId, leadId);
    return NextResponse.json({ ...scheduled, lead }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return serverError(request, "contact", error);
  }
}

const MAX_BULK = 100;

/**
 * Borrado masivo: body `{ ids: string[] }`. Verifica que cada contacto sea del usuario antes de borrar nada.
 * Borra en serie dentro de cada lead (cada borrado recalcula su resumen) y en paralelo entre leads.
 */
export async function DELETE(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  const t = errorTranslator(request);
  const body = await request.json().catch(() => null) as { ids?: unknown } | null;
  const ids = Array.isArray(body?.ids) ? [...new Set(body.ids)] : [];
  if (!ids.length || ids.length > MAX_BULK || !ids.every(isId)) return NextResponse.json({ error: t("generic") }, { status: 400 });
  try {
    const found = await Promise.all(ids.map((id) => getLeadContact(auth.userId, id)));
    if (found.some((contact) => !contact)) return NextResponse.json({ error: t("generic") }, { status: 404 });
    const byLead = new Map<string, LeadContact[]>();
    for (const contact of found as LeadContact[]) byLead.set(contact.leadId, [...(byLead.get(contact.leadId) ?? []), contact]);
    // ponytail: recalcula el resumen del lead una vez por contacto; con una función de borrado por lote en lib/server/lead-suite.ts sería una vez por lead.
    const leads = await Promise.all([...byLead].map(async ([leadId, contacts]) => {
      for (const contact of contacts) await deleteLeadContact(auth.userId, contact.id);
      return getUserLead(auth.userId, leadId);
    }));
    return NextResponse.json(
      { deleted: ids, leads: leads.filter((lead): lead is LeadMatch => Boolean(lead)) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return serverError(request, "bulk contact delete", error);
  }
}
