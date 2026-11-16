import { NextResponse } from "next/server";
import { errorResponse, filterString, findUserSummary, isValidRecordId, listRecords } from "../../../../_shared";
import { asObject, auditRead, clip, generatedGroups, ownedBy, ownerReadContext } from "../../activity/shared";

// Full Leadtita transcript of one user conversation, for the owner. Every successful read is written to the audit log
// first (fail closed). Attachment contents (file text, CSV rows, Drive files) and conversation `extra` are never
// returned: only attachment metadata (name, kind, row count, source). Signed card tokens are dropped too.
// Google API Limited Use: an assistant reply produced from Google Drive content (a `drive_file` read in that turn, or
// the reply right after a user message with a Drive attachment) is withheld (`redacted: "drive"`).

type Row = { id: string; title?: string; messages?: unknown; message_count?: number; last_message_at?: string; created: string; is_active?: boolean };
type Attachment = { name: string; kind: string; rows: number | null; source: "drive" | "upload" };
type TranscriptMessage = {
  role: "user" | "assistant";
  content: string;
  redacted?: "drive";
  at: number | null;
  attachments: Attachment[];
  tools: string[];
  generated: ReturnType<typeof generatedGroups>;
};

const maxMessages = 200;
const maxContent = 20_000;
const attachmentKinds = new Set(["image", "pdf", "text", "csv"]);

const rowCount = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null);

/** Metadata only: the name, kind and row count are copied field by field, so text/csv/preview never leave the server. */
function attachmentMeta(value: unknown): Attachment | null {
  const item = asObject(value);
  const name = clip(item.name, 200);
  if (!name) return null;
  const kind = typeof item.kind === "string" && attachmentKinds.has(item.kind) ? item.kind : "text";
  // Drive files go through driveToContext, which stores size 0; device uploads keep their byte size.
  return { name, kind, rows: rowCount(asObject(item.csv).totalRows), source: item.size === 0 ? "drive" : "upload" };
}

function toMessage(raw: unknown, afterDriveAttachment: boolean): TranscriptMessage {
  const message = asObject(raw);
  const actions = (Array.isArray(message.actions) ? message.actions : []).slice(0, 20).map(asObject);
  const driveFiles = actions.filter((action) => action.type === "drive_file").map((action) => {
    const name = clip(action.name, 200);
    return name ? { name, kind: action.kind === "csv" ? "csv" : "text", rows: rowCount(action.rows), source: "drive" as const } : null;
  });
  const role = message.role === "user" ? "user" : "assistant";
  const redact = role === "assistant" && (afterDriveAttachment || driveFiles.length > 0);
  return {
    role,
    content: redact ? "" : clip(message.content, maxContent),
    ...(redact ? { redacted: "drive" as const } : {}),
    at: typeof message.at === "number" && Number.isFinite(message.at) ? message.at : null,
    attachments: [...(Array.isArray(message.attachments) ? message.attachments.slice(0, 20).map(attachmentMeta) : []), ...driveFiles]
      .filter((item): item is Attachment => item !== null),
    tools: [...new Set(actions.map((action) => clip(action.type === "pending_change" ? asObject(action.change).kind : action.type, 40)).filter(Boolean))],
    generated: generatedGroups({ actions }, 5000),
  };
}

function toTranscript(raw: unknown[]) {
  let afterDrive = false;
  return raw.map((item) => {
    const message = toMessage(item, afterDrive);
    afterDrive = message.role === "user" && message.attachments.some((attachment) => attachment.source === "drive");
    return message;
  });
}

type Context = { params: Promise<{ id: string; conversationId: string }> };

export async function GET(request: Request, context: Context) {
  const { id, conversationId } = await context.params;
  const ready = await ownerReadContext(request, id);
  if ("response" in ready) return ready.response;
  const { owner, t } = ready;
  if (!isValidRecordId(conversationId)) return errorResponse(t("ownerInvalidData"), 404);

  try {
    const [user, result] = await Promise.all([
      findUserSummary(id),
      listRecords<Row>("leadtita_conversations", {
        perPage: 1, skipTotal: 1,
        filter: `id = ${filterString(conversationId)} && ${ownedBy(id)}`,
        fields: "id,title,messages,message_count,last_message_at,created,is_active",
      }),
    ]);
    const row = result.items[0];
    if (!user) return errorResponse(t("ownerUserNotFound"), 404);
    if (!row) return errorResponse(t("ownerInvalidData"), 404);

    const all = Array.isArray(row.messages) ? row.messages : [];
    const title = clip(row.title, 200);
    const stored = await auditRead(request, owner, user, "user.view_conversation", { conversationId: row.id, title, messages: all.length });
    if (!stored) return errorResponse(t("ownerAuditNotReady"), 503);

    return NextResponse.json({
      id: row.id,
      title,
      archived: row.is_active === false,
      created: row.created,
      lastMessageAt: row.last_message_at || row.created,
      messageCount: all.length,
      truncated: all.length > maxMessages,
      messages: toTranscript(all.slice(-maxMessages)),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Owner user conversation failed:", error instanceof Error ? error.name : "unknown");
    return errorResponse(t("ownerUserLoadFailed"), 502);
  }
}
