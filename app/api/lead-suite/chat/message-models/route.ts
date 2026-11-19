import { NextResponse } from "next/server";
import { getCurrentUser, withRefreshedSession } from "@/lib/server/auth";
import { addMessageModel, listMessageModels, removeMessageModel, updateMessageModel } from "@/lib/server/leadtita-message-models";
import { errorTranslator } from "@/lib/server/locale";

async function sessionFor(request: Request) {
  return getCurrentUser(request);
}

export async function GET(request: Request) {
  const t = errorTranslator(request);
  try {
    const session = await sessionFor(request);
    if (!session) return NextResponse.json({ error: t("signInToContinue") }, { status: 401 });
    return withRefreshedSession(NextResponse.json({ items: await listMessageModels(session.user.id) }, { headers: { "Cache-Control": "no-store" } }), session.token);
  } catch {
    return NextResponse.json({ error: t("generic") }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const t = errorTranslator(request);
  try {
    const session = await sessionFor(request);
    if (!session) return NextResponse.json({ error: t("signInToContinue") }, { status: 401 });
    const body = await request.json().catch(() => null) as { name?: unknown; text?: unknown; isDefault?: unknown } | null;
    if (!body || typeof body.text !== "string" || (body.name !== undefined && typeof body.name !== "string") || (body.isDefault !== undefined && typeof body.isDefault !== "boolean")) return NextResponse.json({ error: t("invalidRequestBody") }, { status: 400 });
    const model = await addMessageModel(session.user.id, body.text, body.name, body.isDefault === true);
    return withRefreshedSession(NextResponse.json({ item: model }), session.token);
  } catch (error) {
    if (error instanceof Error && error.message === "message_model_limit") return NextResponse.json({ code: "message_model_limit" }, { status: 409 });
    if (error instanceof Error && error.message.startsWith("invalid_")) return NextResponse.json({ error: t("invalidRequestBody") }, { status: 400 });
    if (error instanceof Error && error.message === "message_model_default_conflict") return NextResponse.json({ code: "message_model_default_conflict" }, { status: 409 });
    return NextResponse.json({ error: t("generic") }, { status: 502 });
  }
}

export async function PATCH(request: Request) {
  const t = errorTranslator(request);
  try {
    const session = await sessionFor(request);
    if (!session) return NextResponse.json({ error: t("signInToContinue") }, { status: 401 });
    const body = await request.json().catch(() => null) as { id?: unknown; name?: unknown; text?: unknown; isDefault?: unknown } | null;
    if (!body || typeof body.id !== "string" || (body.name !== undefined && typeof body.name !== "string") || (body.text !== undefined && typeof body.text !== "string") || (body.isDefault !== undefined && typeof body.isDefault !== "boolean")) return NextResponse.json({ error: t("invalidRequestBody") }, { status: 400 });
    const item = await updateMessageModel(session.user.id, body.id, { name: body.name, text: body.text, isDefault: body.isDefault });
    if (!item) return NextResponse.json({ error: t("generic") }, { status: 404 });
    return withRefreshedSession(NextResponse.json({ item }), session.token);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("invalid_")) return NextResponse.json({ error: t("invalidRequestBody") }, { status: 400 });
    if (error instanceof Error && error.message === "message_model_default_conflict") return NextResponse.json({ code: "message_model_default_conflict" }, { status: 409 });
    return NextResponse.json({ error: t("generic") }, { status: 502 });
  }
}

export async function DELETE(request: Request) {
  const t = errorTranslator(request);
  try {
    const session = await sessionFor(request);
    if (!session) return NextResponse.json({ error: t("signInToContinue") }, { status: 401 });
    const id = new URL(request.url).searchParams.get("id") ?? "";
    if (!/^[a-zA-Z0-9]{15}$/.test(id)) return NextResponse.json({ error: t("invalidRequestBody") }, { status: 400 });
    const removed = await removeMessageModel(session.user.id, id);
    if (!removed) return NextResponse.json({ error: t("generic") }, { status: 404 });
    return withRefreshedSession(NextResponse.json({ removed: true }), session.token);
  } catch {
    return NextResponse.json({ error: t("generic") }, { status: 502 });
  }
}
