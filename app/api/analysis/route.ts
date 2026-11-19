import { NextResponse } from "next/server";
import { getCurrentUser, withRefreshedSession } from "@/lib/server/auth";
import { runLeadAnalysis } from "@/lib/server/lead-analysis";
import { errorTranslator, resolveLocale } from "@/lib/server/locale";

export const maxDuration = 300;

export async function POST(request: Request) {
  const t = errorTranslator(request);
  let session: Awaited<ReturnType<typeof getCurrentUser>>;
  try {
    session = await getCurrentUser(request);
  } catch {
    return NextResponse.json({ error: t("accountService") }, { status: 503 });
  }
  if (!session) return NextResponse.json({ error: t("signInToAnalyze") }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: t("invalidRequestBody") }, { status: 400 });
  }
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: unknown) => { try { controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)); } catch { /* Client disconnected; finish the analysis and persistence normally. */ } };
      const close = () => { try { controller.close(); } catch { /* Stream was cancelled. */ } };
      void runLeadAnalysis(session.user, body, { locale: resolveLocale(request), onProgress: (progress) => send({ type: "progress", ...progress }) })
        .then((result) => { send({ type: "result", status: result.status, body: result.body }); close(); })
        .catch(() => { send({ type: "result", status: 500, body: { error: t("generic") } }); close(); });
    },
  });
  const response = new NextResponse(stream, { status: 200, headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
  return withRefreshedSession(response, session.token);
}
