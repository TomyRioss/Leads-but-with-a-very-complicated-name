import type { LeadContact } from "@/lib/lead-suite";
import { listLeadContacts } from "@/lib/server/lead-suite";

// Shared by the Lead Suite dashboard/insights routes and the MCP server.
const DAY_MS = 86_400_000;
const MAX_RANGE_MS = 366 * DAY_MS;
const MAX_CONTACT_PAGES = 20;

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : NaN;
}

/** Rango validado: default últimos 30 días; `from` <= `to` y como máximo un año. */
export function resolveMetricsRange(fromValue: string | null | undefined, toValue: string | null | undefined) {
  const to = parseDate(toValue) ?? Date.now();
  const from = parseDate(fromValue) ?? to - 30 * DAY_MS;
  if (Number.isNaN(to) || Number.isNaN(from) || from > to || to - from > MAX_RANGE_MS) return null;
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
}

/** Contactos del usuario en [from, to], paginados (100 por página, como máximo 2000). */
export async function loadContactsInRange(userId: string, from: string, to: string): Promise<LeadContact[]> {
  const first = await listLeadContacts(userId, { from, to, page: 1, perPage: 100 });
  const pages = Math.min(first.totalPages, MAX_CONTACT_PAGES);
  const rest = await Promise.all(Array.from({ length: Math.max(0, pages - 1) }, (_, index) => listLeadContacts(userId, { from, to, page: index + 2, perPage: 100 })));
  return [first, ...rest].flatMap((page) => page.items);
}
