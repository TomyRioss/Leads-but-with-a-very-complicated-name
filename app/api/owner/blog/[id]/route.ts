import { NextResponse } from "next/server";
import { BlogInputError, deletePost, getPostForOwner, updatePost } from "@/lib/server/blog";
import { errorTranslator } from "@/lib/server/locale";
import { requireOwner } from "@/lib/server/owner";
import { errorResponse, isNotFound, isValidRecordId, pocketBaseNotReady } from "../../_shared";
import { readBlogRequest } from "../_request";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const t = errorTranslator(request);
  const denied = (await requireOwner(request)) ?? pocketBaseNotReady(request);
  if (denied) return denied;
  const { id } = await context.params;
  if (!isValidRecordId(id)) return errorResponse(t("ownerInvalidData"), 404);
  try {
    const post = await getPostForOwner(id);
    return post ? NextResponse.json({ post }) : errorResponse(t("ownerInvalidData"), 404);
  } catch (error) {
    console.error("Owner blog detail failed:", error instanceof Error ? error.name : "unknown");
    return errorResponse(t("generic"), 502);
  }
}

export async function PATCH(request: Request, context: Context) {
  const t = errorTranslator(request);
  const denied = (await requireOwner(request)) ?? pocketBaseNotReady(request);
  if (denied) return denied;
  const { id } = await context.params;
  if (!isValidRecordId(id)) return errorResponse(t("ownerInvalidData"), 404);
  const parsed = await readBlogRequest(request);
  if (!parsed) return errorResponse(t("ownerInvalidData"), 400);
  try {
    return NextResponse.json({ post: await updatePost(id, parsed.input, parsed.cover) });
  } catch (error) {
    if (error instanceof BlogInputError) {
      return NextResponse.json({ error: t("ownerInvalidData"), field: error.field }, { status: error.field === "id" ? 404 : 400 });
    }
    console.error("Owner blog update failed:", error instanceof Error ? error.name : "unknown");
    return errorResponse(t("generic"), 502);
  }
}

export async function DELETE(request: Request, context: Context) {
  const t = errorTranslator(request);
  const denied = (await requireOwner(request)) ?? pocketBaseNotReady(request);
  if (denied) return denied;
  const { id } = await context.params;
  if (!isValidRecordId(id)) return errorResponse(t("ownerInvalidData"), 404);
  try {
    await deletePost(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isNotFound(error)) return errorResponse(t("ownerInvalidData"), 404);
    console.error("Owner blog delete failed:", error instanceof Error ? error.name : "unknown");
    return errorResponse(t("generic"), 502);
  }
}
