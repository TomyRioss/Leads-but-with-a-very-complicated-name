import { NextResponse } from "next/server";
import { getCurrentUser, withRefreshedSession } from "@/lib/server/auth";
import { isPocketBaseConfigured } from "@/lib/server/pocketbase";
import { isClientId, isConversationInactive } from "@/lib/server/leadtita-conversations";
import { uiError } from "@/lib/server/public-error";
import { errorTranslator, resolveLocale } from "@/lib/server/locale";
import { DEFAULT_TIME_ZONE, isValidTimeZone, parseChatMessages, runLeadSuiteChat } from "@/lib/server/lead-suite-agent";
import { ChatTurnResultError, claimChatTurn, finishChatTurn, type ChatTurnOutcome } from "@/lib/server/leadtita-chat-turns";
import { aiRequestLimit } from "@/lib/server/ai-daily-limit";

export const maxDuration = 900;
// Attachment contexts (CSV rows up to 2,000 per file) travel with the conversation.
const MAX_BODY_BYTES = 3_000_000;
const CONTEXT_FULL = "context_full";
// OpenRouter/provider wording when the prompt exceeds the model's context window.
const CONTEXT_ERROR = /context (?:length|window)|maximum context|too many tokens|prompt is too long|reduce the length/i;

export async function POST(request: Request) {
  const t = errorTranslator(request);
  let session: Awaited<ReturnType<typeof getCurrentUser>>;
  try {
    session = await getCurrentUser(request);
  } catch {
    return NextResponse.json({ error: t("accountService") }, { status: 503 });
  }
  if (!session) return NextResponse.json({ error: t("signInToContinue") }, { status: 401 });
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!isPocketBaseConfigured()) return NextResponse.json({ error: uiError(t("pocketbaseNotConfigured"), t("generic")) }, { status: 503 });
  if (!apiKey) return NextResponse.json({ error: uiError(t("openRouterKeyMissing"), t("generic")) }, { status: 503 });
  const limited = await aiRequestLimit(session.user, t);
  if (limited) return limited;

  let body: { conversationId?: unknown; turnId?: unknown; messages?: unknown; timeZone?: unknown; mode?: unknown; salesChannel?: unknown; permission?: unknown; messageModelId?: unknown; messageModelChoiceMade?: unknown };
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: t("invalidRequestBody"), code: CONTEXT_FULL }, { status: 413 });
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: t("invalidRequestBody"), code: "invalid_request" }, { status: 400 });
  }
  if (!isClientId(body?.conversationId) || !isClientId(body?.turnId)) return NextResponse.json({ error: t("invalidRequestBody"), code: "invalid_request" }, { status: 400 });
  try {
    if (await isConversationInactive(session.user.id, body.conversationId)) return NextResponse.json({ error: t("generic"), code: "conversation_inactive" }, { status: 410 });
  } catch {
    return NextResponse.json({ error: t("accountService") }, { status: 503 });
  }
  const messages = parseChatMessages(body?.messages);
  const timeZone = body?.timeZone === undefined ? DEFAULT_TIME_ZONE : typeof body.timeZone === "string" && body.timeZone.length <= 64 && isValidTimeZone(body.timeZone) ? body.timeZone : null;
  const mode = body?.mode === undefined ? "seller" : body.mode;
  const salesChannel = body?.salesChannel === undefined ? null : body.salesChannel;
  const permission = body?.permission === undefined ? "ask" : body.permission;
  const messageModelId = body?.messageModelId === undefined || body.messageModelId === null ? null : body.messageModelId;
  const messageModelChoiceMade = body?.messageModelChoiceMade === true;
  if (!messages || !timeZone || !["seller", "generator", "planner"].includes(String(mode)) || !(salesChannel === null || salesChannel === "whatsapp" || salesChannel === "gmail") || !(permission === "ask" || permission === "skip" || permission === "danger") || !(messageModelId === null || typeof messageModelId === "string" && /^[a-zA-Z0-9]{15}$/.test(messageModelId)) || (body?.messageModelChoiceMade !== undefined && typeof body.messageModelChoiceMade !== "boolean")) {
    return NextResponse.json({ error: t("invalidRequestBody"), code: "invalid_request" }, { status: 400 });
  }

  const locale = resolveLocale(request);
  let claim: Awaited<ReturnType<typeof claimChatTurn>>;
  try {
    claim = await claimChatTurn(session.user.id, body.conversationId, body.turnId);
  } catch (error) {
    console.error("Lead Suite chat turn claim failed", error);
    return withRefreshedSession(NextResponse.json({ error: t("accountService") }, { status: 503 }), session.token);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (name: string, data: unknown) => {
        try { controller.enqueue(encoder.encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)); } catch { /* client disconnected */ }
      };
      void (async () => {
        if (claim.kind === "completed") { send("complete", claim.result); controller.close(); return; }
        if (claim.kind === "failed") { send("failure", { code: claim.errorCode }); controller.close(); return; }
        if (claim.kind === "running") { send("failure", { code: "turn_in_progress" }); controller.close(); return; }

        try {
          const result = await runLeadSuiteChat({
            userId: session.user.id,
            messages,
            timeZone,
            apiKey,
            locale,
            mode: mode as "seller" | "generator" | "planner",
            salesChannel,
            permission,
            messageModelId,
            messageModelChoiceMade,
            signal: request.signal,
            internalCall: { locale },
            onToolProgress: (event) => send("progress", event),
          });
          if (!result.reply.trim() && !result.actions.length) throw new Error("context_full");
          await finishChatTurn(session.user.id, body.conversationId as string, body.turnId as string, { status: "completed", result });
          send("complete", result);
        } catch (error) {
          if (error instanceof ChatTurnResultError) {
            console.error("Lead Suite chat result rejected", { issue: error.issue, replyChars: error.replyChars, actionCount: error.actionCount, resultBytes: error.resultBytes, actionTypes: error.actionTypes });
          } else {
            console.error("Lead Suite chat failed", error);
          }
          const detail = error instanceof Error ? error.message : String(error);
          const code = error instanceof ChatTurnResultError
            ? error.issue === "result_too_large" || error.issue === "reply_too_long" || error.issue === "too_many_actions" ? "result_too_large" : "result_invalid"
            : CONTEXT_ERROR.test(detail) || detail === "context_full" ? CONTEXT_FULL : request.signal.aborted ? "aborted" : "chat_failed";
          const outcome: ChatTurnOutcome = { status: "failed", errorCode: code };
          await finishChatTurn(session.user.id, body.conversationId as string, body.turnId as string, outcome).catch(() => undefined);
          send("failure", { code });
        } finally {
          try { controller.close(); } catch { /* stream already cancelled */ }
        }
      })();
    },
  });
  return withRefreshedSession(new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  }), session.token);
}
