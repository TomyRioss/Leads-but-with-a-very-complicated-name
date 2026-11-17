import { NextResponse } from "next/server";
import { getCurrentUser, withRefreshedSession } from "@/lib/server/auth";
import { isPocketBaseConfigured } from "@/lib/server/pocketbase";
import { isClientId, isConversationInactive } from "@/lib/server/leadtita-conversations";
import { uiError } from "@/lib/server/public-error";
import { errorTranslator, resolveLocale } from "@/lib/server/locale";
import { confirmLeadtitaViaMcp } from "@/lib/server/mcp/leadtita-confirm";

// Confirmed lead searches run here (through /api/search and /api/people/search), so allow their full duration.
export const maxDuration = 300;
// Import cards carry their signed rows (up to 2,000).
const MAX_BODY_BYTES = 3_000_000;

/** Executes a change the user confirmed with "Yes". The signed token is the only input; it is re-verified and re-validated here. */
export async function POST(request: Request) {
  const t = errorTranslator(request);
  let session: Awaited<ReturnType<typeof getCurrentUser>>;
  try {
    session = await getCurrentUser(request);
  } catch {
    return NextResponse.json({ error: t("accountService") }, { status: 503 });
  }
  if (!session) return NextResponse.json({ error: t("signInToContinue") }, { status: 401 });
  if (!isPocketBaseConfigured()) return NextResponse.json({ error: uiError(t("pocketbaseNotConfigured"), t("generic")) }, { status: 503 });

  let body: { token?: unknown; conversationId?: unknown; keywords?: unknown; edits?: unknown; auto?: unknown; review?: unknown; sendAt?: unknown };
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: t("invalidRequestBody") }, { status: 413 });
    body = JSON.parse(raw) ?? {};
  } catch {
    return NextResponse.json({ error: t("invalidRequestBody") }, { status: 400 });
  }
  if (!isClientId(body.conversationId)) return NextResponse.json({ error: t("invalidRequestBody") }, { status: 400 });
  try {
    if (await isConversationInactive(session.user.id, body.conversationId)) return NextResponse.json({ error: t("generic"), code: "conversation_inactive" }, { status: 410 });
  } catch {
    return NextResponse.json({ error: t("accountService") }, { status: 503 });
  }

  let outcome: Awaited<ReturnType<typeof confirmLeadtitaViaMcp>>;
  try {
    outcome = await confirmLeadtitaViaMcp(session.user, { token: body.token, keywords: body.keywords, edits: body.edits, review: body.review, sendAt: body.sendAt, auto: body.auto }, { locale: resolveLocale(request) });
  } catch (error) {
    // A broken MCP connection must never fall back to executing the action directly.
    console.error("Leadtita confirmation MCP failed", error instanceof Error ? error.name : "unknown");
    return withRefreshedSession(NextResponse.json({ error: t("generic") }, { status: 503 }), session.token);
  }
  if (outcome.ok) return withRefreshedSession(NextResponse.json({ result: outcome.result }), session.token);
  // Malformed confirmations (bad token/subsets/sendAt) answer without refreshing the session, as before.
  const invalidBody = outcome.status === 400 && outcome.code !== "invalid";
  const response = NextResponse.json({ error: outcome.error ?? t(invalidBody ? "invalidRequestBody" : "generic"), ...(outcome.code ? { code: outcome.code } : {}), ...outcome.extra }, { status: outcome.status });
  return invalidBody ? response : withRefreshedSession(response, session.token);
}
