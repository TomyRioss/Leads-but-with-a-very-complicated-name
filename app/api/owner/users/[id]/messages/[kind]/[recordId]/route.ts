import { NextResponse } from "next/server";
import { errorResponse, filterString, findUserSummary, isValidRecordId, listRecords } from "../../../../../_shared";
import { auditRead, clip, generatedGroups, ownedBy, ownerReadContext } from "../../../activity/shared";

// Full body of one message of a user (recorded contact, scheduled send or Leadtita-generated suggestion), for the owner.
// The record must belong to that user; every successful read is written to the audit log first (fail closed).

const kinds = ["contact", "scheduled", "generated"] as const;
type Kind = (typeof kinds)[number];

type ContactRow = { id: string; channel?: string; status?: string; message?: string; notes?: string; contacted_at?: string; created: string; expand?: { lead?: { name?: string } } };
type ScheduledRow = { id: string; channel?: string; recipient?: string; lead_name?: string; subject?: string; body?: string; send_at?: string; status?: string; error?: string; sent_at?: string; created: string };
type TurnRow = { id: string; conversation_id?: string; result?: unknown; created: string };

const one = <T,>(collection: string, recordId: string, userId: string, fields: string, expand?: string) =>
  listRecords<T>(collection, {
    perPage: 1, skipTotal: 1, fields,
    filter: `id = ${filterString(recordId)} && ${ownedBy(userId)}`,
    ...(expand ? { expand } : {}),
  }).then((result) => result.items[0] ?? null);

/** Loads the record of `kind` owned by `userId` and maps it to the response body; null when it isn't theirs. */
async function load(kind: Kind, recordId: string, userId: string) {
  if (kind === "contact") {
    const row = await one<ContactRow>("lead_contacts", recordId, userId, "id,channel,status,message,notes,contacted_at,created,expand.lead.name", "lead");
    return row && {
      kind, id: row.id, leadName: clip(row.expand?.lead?.name, 255), channel: clip(row.channel, 40), status: clip(row.status, 40),
      message: clip(row.message, 4000), notes: clip(row.notes, 4000), date: row.contacted_at || row.created,
    };
  }
  if (kind === "scheduled") {
    const row = await one<ScheduledRow>("scheduled_messages", recordId, userId, "id,channel,recipient,lead_name,subject,body,send_at,status,error,sent_at,created");
    return row && {
      kind, id: row.id, channel: row.channel === "email" ? "email" : "whatsapp", recipient: clip(row.recipient, 300), leadName: clip(row.lead_name, 300),
      subject: clip(row.subject, 300), body: clip(row.body, 20_000), sendAt: row.send_at || row.created, status: clip(row.status, 20),
      error: clip(row.error, 60), sentAt: row.sent_at || "", created: row.created,
    };
  }
  const row = await one<TurnRow>("leadtita_chat_turns", recordId, userId, "id,conversation_id,result,created");
  if (!row) return null;
  const groups = generatedGroups(row.result, 10_000);
  return groups.length ? { kind, id: row.id, date: row.created, groups } : null;
}

type Context = { params: Promise<{ id: string; kind: string; recordId: string }> };

export async function GET(request: Request, context: Context) {
  const { id, kind, recordId } = await context.params;
  const ready = await ownerReadContext(request, id);
  if ("response" in ready) return ready.response;
  const { owner, t } = ready;
  if (!kinds.includes(kind as Kind) || !isValidRecordId(recordId)) return errorResponse(t("ownerInvalidData"), 404);

  try {
    const [user, body] = await Promise.all([findUserSummary(id), load(kind as Kind, recordId, id)]);
    if (!user) return errorResponse(t("ownerUserNotFound"), 404);
    if (!body) return errorResponse(t("ownerInvalidData"), 404);
    const stored = await auditRead(request, owner, user, "user.view_message", { kind, recordId: body.id });
    if (!stored) return errorResponse(t("ownerAuditNotReady"), 503);
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Owner user message failed:", error instanceof Error ? error.name : "unknown");
    return errorResponse(t("ownerUserLoadFailed"), 502);
  }
}
