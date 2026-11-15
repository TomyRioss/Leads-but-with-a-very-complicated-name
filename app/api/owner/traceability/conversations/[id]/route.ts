import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/server/owner";
import { errorTranslator } from "@/lib/server/locale";
import { getTraceConversation } from "@/lib/server/owner-traceability";
import { errorResponse, isValidRecordId, pocketBaseNotReady } from "../../../_shared";

/** GET → one Leadtita conversation (messages, tools, cards and their state) for the owner. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const t = errorTranslator(request);
  const denied = (await requireOwner(request)) ?? pocketBaseNotReady(request);
  if (denied) return denied;
  const { id } = await params;
  if (!isValidRecordId(id)) return errorResponse(t("ownerInvalidData"), 400);

  try {
    const conversation = await getTraceConversation(id);
    if (!conversation) return errorResponse(t("generic"), 404);
    return NextResponse.json(conversation, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Owner traceability conversation failed:", error instanceof Error ? error.name : "unknown");
    return errorResponse(t("generic"), 502);
  }
}
