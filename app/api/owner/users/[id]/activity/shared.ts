// Helpers shared by the owner "Actividad" routes (summary + audited full-content reads). Not a route.
import { getOwnerSession, type OwnerIdentity } from "@/lib/server/owner";
import { errorTranslator } from "@/lib/server/locale";
import { recordOwnerAction, type OwnerAuditAction } from "@/lib/server/owner-audit";
import { errorResponse, filterString, isValidRecordId, pocketBaseNotReady } from "../../../_shared";

export const excerptLength = 160;

export const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/** Plain string capped at `max` characters ("" for non-strings). */
export const clip = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : "");

/** Single-line preview of at most 160 characters. */
export function excerpt(value: unknown, max = excerptLength) {
  if (typeof value !== "string") return "";
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

export const ownedBy = (userId: string) => `user = ${filterString(userId)}`;

export type GeneratedMessage = { channel: "whatsapp" | "email"; subject: string; text: string };
export type GeneratedGroup = { leadName: string; messages: GeneratedMessage[] };

/** `message_suggestions` actions of a chat turn result, normalized (the result json is model output: never trusted). */
export function generatedGroups(result: unknown, textMax: number): GeneratedGroup[] {
  const actions = asObject(result).actions;
  if (!Array.isArray(actions)) return [];
  return actions.slice(0, 20).map(asObject).filter((action) => action.type === "message_suggestions").map((action) => ({
    leadName: clip(action.leadName, 255),
    messages: (Array.isArray(action.messages) ? action.messages : []).slice(0, 10).map(asObject).map((message) => ({
      channel: message.channel === "email" ? "email" as const : "whatsapp" as const,
      subject: clip(message.subject, 300),
      text: clip(message.text, textMax),
    })),
  }));
}

/**
 * Owner check + user lookup for a full-content read. Returns the owner, the target user and a translator, or the
 * error response to return.
 */
export async function ownerReadContext(request: Request, userId: string) {
  const t = errorTranslator(request);
  const session = await getOwnerSession(request);
  if ("response" in session) return { response: session.response };
  const notReady = pocketBaseNotReady(request);
  if (notReady) return { response: notReady };
  if (!isValidRecordId(userId)) return { response: errorResponse(t("ownerUserNotFound"), 404) };
  return { owner: session.owner, t };
}

/** Writes the audit entry for a full-content read. Content is only disclosed when the entry was stored (fail closed). */
export async function auditRead(
  request: Request,
  owner: OwnerIdentity,
  user: { id: string; email: string },
  action: Extract<OwnerAuditAction, "user.view_conversation" | "user.view_message">,
  details: Record<string, unknown>,
) {
  return recordOwnerAction(request, owner, { action, targetType: "user", targetId: user.id, targetLabel: user.email, details });
}
