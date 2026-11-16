import { NextResponse } from "next/server";
import { getOwnerSession } from "@/lib/server/owner";
import { aiRequestLimit } from "@/lib/server/ai-daily-limit";
import { errorTranslator, resolveLocale } from "@/lib/server/locale";
import { uiError } from "@/lib/server/public-error";
import { isOwnerPermission } from "@/lib/server/owner-assistant-policy";
import { parseOwnerMessages, runOwnerAssistant } from "@/lib/server/owner-assistant";
import { pocketBaseNotReady } from "../_shared";

export const maxDuration = 300;
const MAX_BODY_BYTES = 120_000;
const DEFAULT_TIME_ZONE = "America/Argentina/Buenos_Aires";
const CONTEXT_ERROR = /context (?:length|window)|maximum context|too many tokens|prompt is too long|reduce the length/i;

function validTimeZone(value: unknown) {
  if (value === undefined) return DEFAULT_TIME_ZONE;
  if (typeof value !== "string" || value.length > 64) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    return null;
  }
}

/** Leadtita Staff chat turn (SSE). Owner only: the role check runs before the body is read or any model call. */
export async function POST(request: Request) {
  const session = await getOwnerSession(request);
  if ("response" in session) return session.response;
  const t = errorTranslator(request);
  const denied = pocketBaseNotReady(request);
  if (denied) return denied;
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return NextResponse.json({ error: uiError(t("openRouterKeyMissing"), t("generic")) }, { status: 503 });
  // Owners skip the daily cap but share the per-minute AI limit.
  const limited = await aiRequestLimit({ id: session.owner.id, role: "owner" }, t, { daily: false });
  if (limited) return limited;

  let body: { messages?: unknown; permission?: unknown; timeZone?: unknown };
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: t("invalidRequestBody"), code: "context_full" }, { status: 413 });
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: t("invalidRequestBody") }, { status: 400 });
  }
  const messages = parseOwnerMessages(body?.messages);
  const permission = body?.permission === undefined ? "ask" : body.permission;
  const timeZone = validTimeZone(body?.timeZone);
  if (!messages || !isOwnerPermission(permission) || !timeZone) return NextResponse.json({ error: t("invalidRequestBody") }, { status: 400 });

  const locale = resolveLocale(request);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (name: string, data: unknown) => {
        try { controller.enqueue(encoder.encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)); } catch { /* client disconnected */ }
      };
      void (async () => {
        try {
          const result = await runOwnerAssistant({
            owner: session.owner,
            messages,
            permission,
            apiKey,
            timeZone,
            signal: request.signal,
            call: { origin: new URL(request.url).origin, cookie: request.headers.get("cookie") ?? "", locale },
            onToolProgress: (event) => send("progress", event),
          });
          if (!result.reply.trim() && !result.actions.length) throw new Error("context_full");
          send("complete", result);
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          console.error("Owner assistant failed:", detail.slice(0, 200));
          send("failure", { code: CONTEXT_ERROR.test(detail) || detail === "context_full" ? "context_full" : request.signal.aborted ? "aborted" : "chat_failed" });
        } finally {
          try { controller.close(); } catch { /* stream already cancelled */ }
        }
      })();
    },
  });
  return new NextResponse(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" },
  });
}
