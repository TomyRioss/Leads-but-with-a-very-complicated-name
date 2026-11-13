import { NextResponse } from "next/server";
import { isValidPhoneNumber } from "libphonenumber-js/min";
import { clearPendingPhoneCookie, getCurrentUser, getPendingPhoneUser, setSessionCookie } from "@/lib/server/auth";
import { errorTranslator } from "@/lib/server/locale";
import { PocketBaseRequestError, pocketBaseFetch } from "@/lib/server/pocketbase";

/** Saves users.phone for the authenticated user (pending Google sign-in or active session) and starts the session. */
export async function POST(request: Request) {
  let body: { phone?: unknown; locale?: unknown };
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const t = errorTranslator(request, body.locale);
  const phone = typeof body.phone === "string" ? body.phone : "";
  if (!isValidPhoneNumber(phone)) return NextResponse.json({ error: t("invalidPhone") }, { status: 400 });

  try {
    const pending = await getPendingPhoneUser(request);
    const session = pending ?? await getCurrentUser(request);
    if (!session) return NextResponse.json({ error: t("signInToContinue") }, { status: 401 });

    await pocketBaseFetch(`/api/collections/users/records/${encodeURIComponent(session.user.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ phone }),
    });
    const response = NextResponse.json({ user: session.user });
    setSessionCookie(response, session.token);
    clearPendingPhoneCookie(response);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof PocketBaseRequestError && (error.status === 400 || error.status === 409)) {
      let code = "";
      try {
        code = (JSON.parse(error.detail) as { data?: { phone?: { code?: string } } }).data?.phone?.code ?? "";
      } catch {}
      return code === "validation_not_unique"
        ? NextResponse.json({ error: t("phoneTaken") }, { status: 409 })
        : NextResponse.json({ error: t("invalidPhone") }, { status: 400 });
    }
    return NextResponse.json({ error: t("accountService") }, { status: 503 });
  }
}
