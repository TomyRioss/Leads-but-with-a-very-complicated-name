import { NextResponse } from "next/server";
import type { BlogPostInput, BlogStatus } from "@/lib/blog";
import { BlogInputError, createPost, listPostsForOwner } from "@/lib/server/blog";
import { errorTranslator } from "@/lib/server/locale";
import { requireOwner } from "@/lib/server/owner";
import { errorResponse, pocketBaseNotReady } from "../_shared";
import { readBlogRequest } from "./_request";

function positiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.min(parsed, max) : fallback;
}

export async function GET(request: Request) {
  const t = errorTranslator(request);
  const denied = (await requireOwner(request)) ?? pocketBaseNotReady(request);
  if (denied) return denied;
  const params = new URL(request.url).searchParams;
  const status = params.get("status");
  try {
    return NextResponse.json(await listPostsForOwner({
      page: positiveInt(params.get("page"), 1, 10_000),
      perPage: positiveInt(params.get("perPage"), 25, 100),
      status: status === "draft" || status === "published" ? (status as BlogStatus) : undefined,
      q: params.get("q") ?? undefined,
    }));
  } catch (error) {
    console.error("Owner blog list failed:", error instanceof Error ? error.name : "unknown");
    return errorResponse(t("generic"), 502);
  }
}

export async function POST(request: Request) {
  const t = errorTranslator(request);
  const denied = (await requireOwner(request)) ?? pocketBaseNotReady(request);
  if (denied) return denied;
  const parsed = await readBlogRequest(request);
  if (!parsed) return errorResponse(t("ownerInvalidData"), 400);
  try {
    const post = await createPost(parsed.input as BlogPostInput, parsed.cover === "remove" ? null : parsed.cover);
    return NextResponse.json({ post }, { status: 201 });
  } catch (error) {
    if (error instanceof BlogInputError) return NextResponse.json({ error: t("ownerInvalidData"), field: error.field }, { status: 400 });
    console.error("Owner blog create failed:", error instanceof Error ? error.name : "unknown");
    return errorResponse(t("generic"), 502);
  }
}
