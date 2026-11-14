import { connection, NextResponse } from "next/server";
import { getCurrentUser, withRefreshedSession } from "@/lib/server/auth";
import { errorTranslator } from "@/lib/server/locale";
import { getCommercialProfile, updateCommercialProfile } from "@/lib/server/user-profile";

async function session(request: Request) {
  try {
    return { session: await getCurrentUser(request) };
  } catch {
    return { failed: true as const };
  }
}

/** Commercial profile of the signed-in user only (service offering + usual sectors). */
export async function GET(request: Request) {
  const t = errorTranslator(request);
  await connection();
  const auth = await session(request);
  if ("failed" in auth) return NextResponse.json({ error: t("accountService") }, { status: 503 });
  if (!auth.session) return NextResponse.json({ error: t("signInToContinue") }, { status: 401 });
  try {
    const profile = await getCommercialProfile(auth.session.user.id);
    return withRefreshedSession(NextResponse.json({ profile }), auth.session.token);
  } catch {
    return NextResponse.json({ error: t("accountService") }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const t = errorTranslator(request);
  const auth = await session(request);
  if ("failed" in auth) return NextResponse.json({ error: t("accountService") }, { status: 503 });
  if (!auth.session) return NextResponse.json({ error: t("signInToContinue") }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: t("invalidRequestBody") }, { status: 400 });
  const { serviceOffering, commercialSectors } = body;
  if ((serviceOffering !== undefined && typeof serviceOffering !== "string") || (commercialSectors !== undefined && typeof commercialSectors !== "string")) {
    return NextResponse.json({ error: t("invalidRequestBody") }, { status: 400 });
  }
  try {
    const profile = await updateCommercialProfile(auth.session.user.id, { serviceOffering, commercialSectors });
    return withRefreshedSession(NextResponse.json({ profile }), auth.session.token);
  } catch {
    return NextResponse.json({ error: t("accountService") }, { status: 503 });
  }
}
