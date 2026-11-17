import { NextResponse } from "next/server";
import { getEmailUser, readPasswordResetToken, updateEmailUser } from "@/lib/server/email";
import { errorTranslator } from "@/lib/server/locale";
import { PocketBaseRequestError } from "@/lib/server/pocketbase";

const invalid = () => NextResponse.json({ result: "invalid" }, { status: 400 });

/** Sets the new password from a reset link. PocketBase rotates the tokenKey, so old sessions end too. */
export async function POST(request: Request) {
  let body: { token?: unknown; password?: unknown; passwordConfirm?: unknown; locale?: unknown };
  try {
    body = await request.json();
  } catch {
    return invalid();
  }
  const t = errorTranslator(request, body.locale);
  const claims = typeof body.token === "string" ? readPasswordResetToken(body.token) : null;
  if (!claims) return invalid();

  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < 6 || password.length > 128) {
    return NextResponse.json({ error: t("passwordLength") }, { status: 400 });
  }
  if (password !== body.passwordConfirm) {
    return NextResponse.json({ error: t("passwordMismatch") }, { status: 400 });
  }

  try {
    const user = await getEmailUser(claims.id);
    // `updated` moved on: the link was already used (or the account changed since it was sent).
    if (user.email.toLowerCase() !== claims.email || (user.updated ?? "") !== claims.v) return invalid();
    await updateEmailUser(user.id, { password, passwordConfirm: password });
    return NextResponse.json({ result: "reset" });
  } catch (error) {
    if (error instanceof PocketBaseRequestError && error.status === 404) return invalid();
    console.error("Leadta password reset failed:", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: t("accountService") }, { status: 503 });
  }
}
