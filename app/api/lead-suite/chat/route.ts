import { NextResponse } from "next/server";
import { getCurrentUser, withRefreshedSession } from "@/lib/server/auth";
import { isPocketBaseConfigured } from "@/lib/server/pocketbase";
import { uiError } from "@/lib/server/public-error";
import { errorTranslator, resolveLocale } from "@/lib/server/locale";
import { DEFAULT_TIME_ZONE, isValidTimeZone, parseChatMessages, runLeadSuiteChat } from "@/lib/server/lead-suite-agent";

export const maxDuration = 300;
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

  let body: { messages?: unknown; timeZone?: unknown };
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: t("invalidRequestBody"), code: CONTEXT_FULL }, { status: 413 });
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: t("invalidRequestBody") }, { status: 400 });
  }
  const messages = parseChatMessages(body?.messages);
  const timeZone = body?.timeZone === undefined ? DEFAULT_TIME_ZONE : typeof body.timeZone === "string" && body.timeZone.length <= 64 && isValidTimeZone(body.timeZone) ? body.timeZone : null;
  if (!messages || !timeZone) return NextResponse.json({ error: t("invalidRequestBody") }, { status: 400 });

  try {
    const result = await runLeadSuiteChat({ userId: session.user.id, messages, timeZone, apiKey, locale: resolveLocale(request), signal: request.signal });
    // No text and no card: the model could not answer this conversation; the client offers a new chat.
    if (!result.reply.trim() && !result.actions.length) return withRefreshedSession(NextResponse.json({ error: t("generic"), code: CONTEXT_FULL }, { status: 422 }), session.token);
    return withRefreshedSession(NextResponse.json(result), session.token);
  } catch (error) {
    console.error("Lead Suite chat failed", error);
    const detail = error instanceof Error ? error.message : String(error);
    if (CONTEXT_ERROR.test(detail)) return withRefreshedSession(NextResponse.json({ error: t("generic"), code: CONTEXT_FULL }, { status: 413 }), session.token);
    return withRefreshedSession(NextResponse.json({ error: uiError(detail, t("generic")) }, { status: 502 }), session.token);
  }
}
