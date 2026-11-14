import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server/auth";
import { PocketBaseRequestError } from "@/lib/server/pocketbase";
import { errorTranslator } from "@/lib/server/locale";
import { uiError } from "@/lib/server/public-error";
import { CONTACT_CHANNELS, CONTACT_STATUSES, type ContactChannel, type ContactStatus, type LeadContact } from "@/lib/lead-suite";
import { getLeadPainBrief, updateLeadContact } from "@/lib/server/lead-suite";
import { CalendarNotConnectedError, createCalendarEvent } from "@/lib/server/google-calendar";
import { isValidEmail } from "@/lib/server/google-gmail";

// Reglas compartidas por las rutas de contactos (alta, edición y "Modificar con IA").
const CHANNELS: readonly string[] = CONTACT_CHANNELS;
const STATUSES: readonly string[] = CONTACT_STATUSES;
const FUTURE_TOLERANCE_MS = 5 * 60_000;
export const MAX_MESSAGE = 4000;
export const MAX_NOTES = 2000;

export type ContactFields = { channel: ContactChannel; contactedAt: string; status: ContactStatus; message: string; notes: string };

export const isId = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9]{1,32}$/i.test(value);

/** Valida campos de contacto. Con `partial`, los ausentes se omiten; si no, canal y fecha son obligatorios. */
export function parseContactFields(body: unknown, partial: boolean): Partial<ContactFields> | null {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  const out: Partial<ContactFields> = {};
  if (value.channel !== undefined) {
    if (typeof value.channel !== "string" || !CHANNELS.includes(value.channel)) return null;
    out.channel = value.channel as ContactChannel;
  } else if (!partial) return null;
  if (value.status !== undefined) {
    if (typeof value.status !== "string" || !STATUSES.includes(value.status)) return null;
    out.status = value.status as ContactStatus;
  }
  if (value.contactedAt !== undefined) {
    if (typeof value.contactedAt !== "string") return null;
    const time = Date.parse(value.contactedAt);
    if (!Number.isFinite(time) || time > Date.now() + FUTURE_TOLERANCE_MS) return null;
    out.contactedAt = new Date(time).toISOString();
  } else if (!partial) return null;
  for (const [key, max] of [["message", MAX_MESSAGE], ["notes", MAX_NOTES]] as const) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== "string" || (value[key] as string).length > max) return null;
    out[key] = (value[key] as string).trim();
  }
  return out;
}

/** Sesión obligatoria: devuelve el userId o la respuesta de error lista. */
export async function requireUser(request: Request): Promise<{ userId: string } | { response: NextResponse }> {
  const t = errorTranslator(request);
  try {
    const session = await getCurrentUser(request);
    if (!session) return { response: NextResponse.json({ error: t("signInToContinue") }, { status: 401 }) };
    return { userId: session.user.id };
  } catch {
    return { response: NextResponse.json({ error: t("accountService") }, { status: 503 }) };
  }
}

/** Error de servidor con el patrón existente (detalle solo en dev). */
export function serverError(request: Request, label: string, error: unknown) {
  const t = errorTranslator(request);
  const pb = error instanceof PocketBaseRequestError ? { status: error.status, operation: error.operation, detail: error.detail.slice(0, 500) } : null;
  const detail = pb ? `PocketBase ${pb.status}: ${pb.detail || (error as Error).message}` : error instanceof Error ? error.message : "unknown";
  console.error(`Lead Suite ${label} failed:`, error instanceof Error ? error.name : "unknown", pb ?? "");
  return NextResponse.json({ error: uiError(detail, t("generic")) }, { status: 502 });
}

// ---------- "Agendar en Google Calendar" (status Reunión) ----------

export type MeetingRequest = { start: string; durationMinutes: number; timeZone: string; invite: boolean; meet: boolean };
const MEETING_MINUTES = [15, 30, 45, 60, 90, 120];

/** Optional `calendar` object of the contact form; null when absent, "invalid" when malformed. */
export function parseMeetingRequest(body: unknown): MeetingRequest | null | "invalid" {
  const raw = body && typeof body === "object" ? (body as Record<string, unknown>).calendar : undefined;
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object") return "invalid";
  const value = raw as Record<string, unknown>;
  const start = typeof value.start === "string" ? Date.parse(value.start) : NaN;
  const minutes = Number(value.durationMinutes);
  const timeZone = typeof value.timeZone === "string" && value.timeZone.length <= 64 ? value.timeZone : "UTC";
  if (!Number.isFinite(start) || start < Date.now() - 60 * 60_000 || !MEETING_MINUTES.includes(minutes)) return "invalid";
  return { start: new Date(start).toISOString(), durationMinutes: minutes, timeZone, invite: value.invite === true, meet: value.meet === true };
}

/**
 * Creates the Calendar event for a contact saved as Reunión and appends its link to the contact notes (so it shows in
 * the contact history). The contact is already saved: a Calendar failure is reported, never undoes it.
 */
export async function scheduleMeeting(userId: string, contact: LeadContact, request: MeetingRequest): Promise<{ contact: LeadContact; calendarError?: "needs_calendar" | "failed" }> {
  try {
    const brief = await getLeadPainBrief(userId, contact.leadId);
    const email = brief?.email ?? "";
    const event = await createCalendarEvent(userId, {
      title: `Reunión con ${contact.leadName}`,
      start: request.start,
      end: new Date(Date.parse(request.start) + request.durationMinutes * 60_000).toISOString(),
      timeZone: request.timeZone,
      description: contact.message ? contact.message.slice(0, 2000) : `Leadta · ${contact.leadName}`,
      ...(request.invite && isValidEmail(email) ? { attendees: [email] } : {}),
      meet: request.meet,
    });
    const link = [`Evento: ${event.htmlLink}`, event.meetLink ? `Meet: ${event.meetLink}` : ""].filter(Boolean).join("\n");
    const notes = [contact.notes, link].filter(Boolean).join("\n").slice(0, MAX_NOTES);
    return { contact: await updateLeadContact(userId, contact.id, { notes }) };
  } catch (error) {
    if (error instanceof CalendarNotConnectedError) return { contact, calendarError: "needs_calendar" };
    console.error("Lead Suite calendar event failed:", error instanceof Error ? error.name : "unknown");
    return { contact, calendarError: "failed" };
  }
}
