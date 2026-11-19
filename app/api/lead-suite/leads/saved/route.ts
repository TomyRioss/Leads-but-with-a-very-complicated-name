import { NextResponse } from "next/server";
import { getCurrentUser, withRefreshedSession } from "@/lib/server/auth";
import { setBatchLeadsSaved, setLeadSaved, setLeadsSaved } from "@/lib/server/lead-suite";
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

  let body: { leadId?: unknown; leadIds?: unknown; batchId?: unknown; saved?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: t("invalidRequestBody") }, { status: 400 });
  }
  if (typeof body?.saved !== "boolean" || (body.batchId !== undefined
    ? typeof body.batchId !== "string" || !/^[a-zA-Z0-9]{15}$/.test(body.batchId)
    : body.leadIds !== undefined
      ? !Array.isArray(body.leadIds) || body.leadIds.length > 150 || body.leadIds.some((id) => typeof id !== "string" || !/^[a-zA-Z0-9]{15}$/.test(id))
      : typeof body.leadId !== "string" || !/^[a-zA-Z0-9]{15}$/.test(body.leadId))) {
    return NextResponse.json({ error: t("invalidRequestBody") }, { status: 400 });
  }

  try {
    if (typeof body.batchId === "string") {
      const savedIds = await setBatchLeadsSaved(session.user.id, body.batchId, body.saved);
      if (!savedIds) return NextResponse.json({ error: t("generic") }, { status: 404 });
      return withRefreshedSession(NextResponse.json({ saved: body.saved, savedIds }), session.token);
    }
    if (Array.isArray(body.leadIds)) {
      const savedIds = await setLeadsSaved(session.user.id, body.leadIds as string[], body.saved);
      return withRefreshedSession(NextResponse.json({ saved: body.saved, savedIds }), session.token);
    }
    const leadId = body.leadId as string;
    if (!(await setLeadSaved(session.user.id, leadId, body.saved))) return NextResponse.json({ error: t("generic") }, { status: 404 });
    return withRefreshedSession(NextResponse.json({ saved: body.saved, savedIds: [leadId] }), session.token);
  } catch (error) {
    console.error("Lead save failed:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: t("generic") }, { status: 502 });
  }
}
