import { NextResponse } from "next/server";
import { getCurrentUser, withRefreshedSession } from "@/lib/server/auth";
import { setLeadSaved } from "@/lib/server/lead-suite";
import { errorTranslator } from "@/lib/server/locale";

/** Saves/unsaves a lead for the Leadtita sidebar ("Leads guardados"). Body: { leadId, saved }. */
export async function POST(request: Request) {
  const t = errorTranslator(request);
  let session: Awaited<ReturnType<typeof getCurrentUser>>;
  try {
    session = await getCurrentUser(request);
  } catch {
    return NextResponse.json({ error: t("accountService") }, { status: 503 });
  }
  if (!session) return NextResponse.json({ error: t("signInToContinue") }, { status: 401 });

  let body: { leadId?: unknown; saved?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: t("invalidRequestBody") }, { status: 400 });
  }
  if (typeof body?.leadId !== "string" || !/^[a-zA-Z0-9]{15}$/.test(body.leadId) || typeof body.saved !== "boolean") {
    return NextResponse.json({ error: t("invalidRequestBody") }, { status: 400 });
  }

  try {
    if (!(await setLeadSaved(session.user.id, body.leadId, body.saved))) return NextResponse.json({ error: t("generic") }, { status: 404 });
    return withRefreshedSession(NextResponse.json({ saved: body.saved }), session.token);
  } catch (error) {
    console.error("Lead save failed:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: t("generic") }, { status: 502 });
  }
}
