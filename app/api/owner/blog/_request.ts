import type { BlogPostInput } from "@/lib/blog";
import { BLOG_COVER_MAX_BYTES } from "@/lib/server/blog";
import { readJsonObject } from "../_shared";

const keys = ["title", "slug", "locale", "excerpt", "content", "coverAlt", "seoTitle", "seoDescription", "tags", "status", "publishedAt", "authorName"] as const;

export type ParsedBlogRequest = { input: Partial<BlogPostInput>; cover: File | null | "remove" } | null;

function pick(body: Record<string, unknown>) {
  const input: Record<string, unknown> = {};
  for (const key of keys) if (body[key] !== undefined) input[key] = body[key];
  return input as Partial<BlogPostInput>;
}

/**
 * JSON body = BlogPostInput (no cover), or multipart/form-data with `data` = JSON string of BlogPostInput and `cover` = File.
 * `removeCover: true` inside the JSON / `data` removes the cover. Returns null on a malformed body.
 */
export async function readBlogRequest(request: Request): Promise<ParsedBlogRequest> {
  if (!(request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const body = await readJsonObject(request);
    return body ? { input: pick(body), cover: body.removeCover === true ? "remove" : null } : null;
  }
  // Reject oversized uploads before buffering the form.
  if (Number(request.headers.get("content-length") ?? 0) > BLOG_COVER_MAX_BYTES + 512 * 1024) return null;
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return null;
  }
  const raw = form.get("data");
  let body: unknown;
  try {
    body = typeof raw === "string" ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const data = body as Record<string, unknown>;
  const file = form.get("cover");
  const cover = file instanceof File && file.size > 0 ? file : data.removeCover === true ? "remove" : null;
  return { input: pick(data), cover };
}
