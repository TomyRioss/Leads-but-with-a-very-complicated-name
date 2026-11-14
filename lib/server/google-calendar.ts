// Google Calendar (calendar.events scope): create/update/delete events in the user's primary calendar.
import { GOOGLE_SCOPES, GoogleNotConnectedError, getConnection, getValidAccessToken, scopesInclude } from "@/lib/server/google-connections";
import { isValidEmail } from "@/lib/server/google-gmail";

export const CALENDAR_LIMITS = { title: 300, description: 8_000, attendees: 50, timeoutMs: 20_000 } as const;

export type CalendarEventInput = { title: string; start: string; end: string; timeZone: string; description?: string; attendees?: string[]; meet?: boolean };
export type CalendarEventResult = { id: string; htmlLink: string; meetLink?: string };

export class CalendarNotConnectedError extends Error {
  constructor() {
    super("Google Calendar is not connected.");
    this.name = "CalendarNotConnectedError";
  }
}

export type CalendarValidationField = "title" | "start" | "end" | "timeZone" | "description" | "attendees" | "eventId";
export class CalendarValidationError extends Error {
  readonly field: CalendarValidationField;
  constructor(field: CalendarValidationField) {
    super(`Invalid calendar field: ${field}.`);
    this.name = "CalendarValidationError";
    this.field = field;
  }
}

export class CalendarApiError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`Google Calendar responded ${status}.`);
    this.name = "CalendarApiError";
    this.status = status;
  }
}

// ---------- Pure helpers ----------

/** ISO local or offset date-time: 2026-11-20T15:00, 2026-11-20T15:00:00-03:00, …Z. */
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/;

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return Boolean(value);
  } catch {
    return false;
  }
}

function validDateTime(value: unknown, field: "start" | "end") {
  if (typeof value !== "string" || !DATE_TIME.test(value) || Number.isNaN(Date.parse(value))) throw new CalendarValidationError(field);
  return value;
}

function cleanAttendees(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new CalendarValidationError("attendees");
  const emails = [...new Set(value.map((item) => (typeof item === "string" ? item.trim().toLowerCase() : "")))];
  if (emails.some((email) => !isValidEmail(email)) || emails.length > CALENDAR_LIMITS.attendees) throw new CalendarValidationError("attendees");
  return emails;
}

type EventPayload = Record<string, unknown>;

/** Google events.insert/patch body plus query params. `partial` (update) only includes the given fields. */
export function buildEventPayload(input: Partial<CalendarEventInput>, opts: { partial?: boolean; requestId?: string } = {}): { body: EventPayload; params: URLSearchParams } {
  const body: EventPayload = {};
  const params = new URLSearchParams();
  const need = (key: keyof CalendarEventInput) => !opts.partial || input[key] !== undefined;

  if (need("title")) {
    const title = typeof input.title === "string" ? input.title.replace(/\s+/g, " ").trim() : "";
    if (!title || title.length > CALENDAR_LIMITS.title) throw new CalendarValidationError("title");
    body.summary = title;
  }
  if (input.description !== undefined) {
    if (typeof input.description !== "string" || input.description.length > CALENDAR_LIMITS.description) throw new CalendarValidationError("description");
    body.description = input.description.trim();
  }
  const timesGiven = need("start") || need("end") || input.timeZone !== undefined;
  if (timesGiven) {
    const timeZone = typeof input.timeZone === "string" ? input.timeZone.trim() : "";
    if (!isValidTimeZone(timeZone)) throw new CalendarValidationError("timeZone");
    const start = validDateTime(input.start, "start");
    const end = validDateTime(input.end, "end");
    if (Date.parse(end) <= Date.parse(start)) throw new CalendarValidationError("end");
    body.start = { dateTime: start, timeZone };
    body.end = { dateTime: end, timeZone };
  }
  const attendees = cleanAttendees(input.attendees);
  if (input.attendees !== undefined) body.attendees = attendees.map((email) => ({ email }));
  if (input.meet) {
    body.conferenceData = { createRequest: { requestId: opts.requestId ?? crypto.randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } };
    params.set("conferenceDataVersion", "1");
  }
  // Only guests get Google's invitation/update emails; a patch that doesn't touch guests still notifies the existing ones.
  params.set("sendUpdates", attendees.length > 0 || (opts.partial && input.attendees === undefined) ? "all" : "none");
  return { body, params };
}

type EventResponse = { id?: string; htmlLink?: string; hangoutLink?: string; conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] } };

export function eventResult(event: EventResponse): CalendarEventResult {
  const meetLink = event.hangoutLink || event.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === "video")?.uri;
  return { id: event.id ?? "", htmlLink: event.htmlLink ?? "", ...(meetLink ? { meetLink } : {}) };
}

// ---------- Google REST ----------

const EVENTS = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

async function calendarToken(userId: string) {
  const connection = await getConnection(userId);
  if (!connection || !scopesInclude(connection.scopes, GOOGLE_SCOPES.calendarEvents)) throw new CalendarNotConnectedError();
  try {
    return await getValidAccessToken(userId);
  } catch (error) {
    if (error instanceof GoogleNotConnectedError) throw new CalendarNotConnectedError();
    throw error;
  }
}

async function calendarFetch(url: string, token: string, init: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(CALENDAR_LIMITS.timeoutMs),
    });
  } catch {
    throw new CalendarApiError(0);
  }
  if (response.ok) return response;
  if (response.status === 401 || response.status === 403) {
    const body = (await response.json().catch(() => null)) as { error?: { errors?: { reason?: string }[] } } | null;
    const reasons = body?.error?.errors?.map((item) => item.reason) ?? [];
    if (response.status === 401 || reasons.includes("insufficientPermissions")) throw new CalendarNotConnectedError();
  }
  throw new CalendarApiError(response.status);
}

const eventPath = (eventId: string) => {
  if (!/^[A-Za-z0-9_-]{1,1024}$/.test(eventId)) throw new CalendarValidationError("eventId");
  return `${EVENTS}/${encodeURIComponent(eventId)}`;
};

export async function createCalendarEvent(userId: string, input: CalendarEventInput): Promise<CalendarEventResult> {
  const { body, params } = buildEventPayload(input);
  const token = await calendarToken(userId);
  const response = await calendarFetch(`${EVENTS}?${params}`, token, { method: "POST", body: JSON.stringify(body) });
  return eventResult((await response.json()) as EventResponse);
}

/** Patches only the given fields; start/end/timeZone must be sent together. */
export async function updateCalendarEvent(userId: string, eventId: string, input: Partial<CalendarEventInput>): Promise<CalendarEventResult> {
  const path = eventPath(eventId);
  const { body, params } = buildEventPayload(input, { partial: true });
  const token = await calendarToken(userId);
  const response = await calendarFetch(`${path}?${params}`, token, { method: "PATCH", body: JSON.stringify(body) });
  return eventResult((await response.json()) as EventResponse);
}

/** Deletes the event; guests are notified when `notify` is true (default). An already-deleted event is not an error. */
export async function deleteCalendarEvent(userId: string, eventId: string, opts: { notify?: boolean } = {}): Promise<void> {
  const path = eventPath(eventId);
  const token = await calendarToken(userId);
  try {
    await calendarFetch(`${path}?sendUpdates=${opts.notify === false ? "none" : "all"}`, token, { method: "DELETE" });
  } catch (error) {
    if (error instanceof CalendarApiError && (error.status === 404 || error.status === 410)) return;
    throw error;
  }
}
