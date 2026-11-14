import { NextResponse } from "next/server";
import { deleteLeadContact, getLeadContact, getUserLead, updateLeadContact } from "@/lib/server/lead-suite";
import { errorTranslator } from "@/lib/server/locale";
import { isId, parseContactFields, parseMeetingRequest, requireUser, scheduleMeeting, serverError } from "../validate";

type Context = { params: Promise<{ id: string }> };

/** Edita un contacto propio. Devuelve el contacto y el lead con estado/último contacto recalculados. */
export async function PATCH(request: Request, { params }: Context) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  const t = errorTranslator(request);
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const patch = parseContactFields(body, true);
  const meeting = parseMeetingRequest(body);
  if (!isId(id) || !patch || Object.keys(patch).length === 0 || meeting === "invalid") return NextResponse.json({ error: t("generic") }, { status: 400 });
  try {
    // Pertenencia: getLeadContact filtra por usuario; updateLeadContact vuelve a verificar el lead.
    if (!(await getLeadContact(auth.userId, id))) return NextResponse.json({ error: t("generic") }, { status: 404 });
    const contact = await updateLeadContact(auth.userId, id, patch);
    // "Agendar en Google Calendar" only applies to contacts saved as Reunión.
    const scheduled = meeting && contact.status === "meeting" ? await scheduleMeeting(auth.userId, contact, meeting) : { contact };
    const lead = await getUserLead(auth.userId, contact.leadId);
    return NextResponse.json({ ...scheduled, lead }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return serverError(request, "contact update", error);
  }
}

/** Elimina un contacto propio y recalcula el resumen del lead. */
export async function DELETE(request: Request, { params }: Context) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  const t = errorTranslator(request);
  const { id } = await params;
  if (!isId(id)) return NextResponse.json({ error: t("generic") }, { status: 400 });
  try {
    if (!(await getLeadContact(auth.userId, id))) return NextResponse.json({ error: t("generic") }, { status: 404 });
    const contact = await deleteLeadContact(auth.userId, id);
    const lead = await getUserLead(auth.userId, contact.leadId);
    return NextResponse.json({ contact, lead }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return serverError(request, "contact delete", error);
  }
}
