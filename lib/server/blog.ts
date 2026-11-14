import { cacheLife, cacheTag, revalidateTag } from "next/cache";
import {
  BLOG_LOCALES,
  BLOG_SLUG_MAX,
  BLOG_SLUG_PATTERN,
  BLOG_STATUSES,
  readingMinutes,
  slugify,
  type BlogLocale,
  type BlogPost,
  type BlogPostInput,
  type BlogPostSummary,
  type BlogStatus,
} from "@/lib/blog";
import { PocketBaseRequestError, pocketBaseFetch } from "@/lib/server/pocketbase";

export const BLOG_CACHE_TAG = "blog";
export const BLOG_COVER_MAX_BYTES = 5 * 1024 * 1024;
export const BLOG_COVER_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** Invalid owner input; `field` names the offending field. */
export class BlogInputError extends Error {
  constructor(readonly field: string) {
    super(`Invalid blog field: ${field}.`);
    this.name = "BlogInputError";
  }
}

type List<T> = { items: T[]; page: number; totalPages: number };
type PostRow = {
  id: string; title: string; slug: string; locale: string; excerpt?: string; content?: string; cover?: string; cover_alt?: string;
  seo_title?: string; seo_description?: string; tags?: unknown; status: string; published_at?: string; author_name?: string;
  reading_minutes?: number; updated: string;
};

const COLLECTION = "blog_posts";
const SUMMARY_FIELDS = "id,title,slug,locale,excerpt,cover,cover_alt,seo_title,seo_description,tags,status,published_at,author_name,reading_minutes,updated";
const quote = (value: string) => JSON.stringify(value);
const listPath = (params: Record<string, string>) => `/api/collections/${COLLECTION}/records?${new URLSearchParams(params).toString()}`;
const recordPath = (id: string) => `/api/collections/${COLLECTION}/records/${encodeURIComponent(id)}`;
const isLocale = (value: unknown): value is BlogLocale => BLOG_LOCALES.includes(value as BlogLocale);
const isStatus = (value: unknown): value is BlogStatus => BLOG_STATUSES.includes(value as BlogStatus);
const clampInt = (value: number | undefined, min: number, max: number, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.trunc(value))) : fallback;
const pbDate = (iso: string) => new Date(iso).toISOString().replace("T", " ");
const fromPbDate = (value?: string) => (value ? new Date(value.replace(" ", "T")).toISOString() : null);

function coverUrl(row: PostRow) {
  // ponytail: direct PocketBase file URL; behind a bridge-protected POCKETBASE_URL it needs a public proxy route.
  const base = process.env.POCKETBASE_URL?.replace(/\/$/, "");
  return row.cover && base ? `${base}/api/files/${COLLECTION}/${encodeURIComponent(row.id)}/${encodeURIComponent(row.cover)}` : null;
}

function toSummary(row: PostRow): BlogPostSummary {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    locale: isLocale(row.locale) ? row.locale : "es",
    excerpt: row.excerpt ?? "",
    coverUrl: coverUrl(row),
    coverAlt: row.cover_alt ?? "",
    seoTitle: row.seo_title ?? "",
    seoDescription: row.seo_description ?? "",
    tags: Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === "string") : [],
    status: isStatus(row.status) ? row.status : "draft",
    publishedAt: fromPbDate(row.published_at),
    authorName: row.author_name ?? "",
    readingMinutes: row.reading_minutes ?? 1,
    updated: fromPbDate(row.updated) ?? row.updated,
  };
}

const toPost = (row: PostRow): BlogPost => ({ ...toSummary(row), content: row.content ?? "" });

const isNotFound = (error: unknown) => error instanceof PocketBaseRequestError && error.status === 404;

// ---------- Public reads (cached, invalidated by every write) ----------

export async function listPublishedPosts(locale: BlogLocale, opts: { page?: number; perPage?: number; tag?: string } = {}): Promise<{ items: BlogPostSummary[]; page: number; totalPages: number }> {
  "use cache";
  cacheTag(BLOG_CACHE_TAG);
  cacheLife("hours");
  if (!isLocale(locale)) return { items: [], page: 1, totalPages: 0 };
  const filters = [`status = "published"`, `locale = ${quote(locale)}`];
  const tag = opts.tag?.trim().slice(0, 60);
  // ponytail: `tags ~` matches the quoted value inside the JSON text; exact enough for short tags.
  if (tag) filters.push(`tags ~ ${quote(JSON.stringify(tag))}`);
  const result = await pocketBaseFetch<List<PostRow>>(listPath({
    filter: filters.join(" && "),
    sort: "-published_at",
    page: String(clampInt(opts.page, 1, 10_000, 1)),
    perPage: String(clampInt(opts.perPage, 1, 50, 12)),
    fields: SUMMARY_FIELDS,
  }));
  return { items: result.items.map(toSummary), page: result.page, totalPages: result.totalPages };
}

export async function getPublishedPost(locale: BlogLocale, slug: string): Promise<BlogPost | null> {
  "use cache";
  cacheTag(BLOG_CACHE_TAG);
  cacheLife("hours");
  if (!isLocale(locale) || !BLOG_SLUG_PATTERN.test(slug) || slug.length > BLOG_SLUG_MAX) return null;
  const result = await pocketBaseFetch<List<PostRow>>(listPath({
    filter: `status = "published" && locale = ${quote(locale)} && slug = ${quote(slug)}`,
    perPage: "1",
    skipTotal: "1",
  }));
  return result.items[0] ? toPost(result.items[0]) : null;
}

export async function listAllPublishedSlugs(): Promise<{ locale: BlogLocale; slug: string; updated: string }[]> {
  "use cache";
  cacheTag(BLOG_CACHE_TAG);
  cacheLife("hours");
  const out: { locale: BlogLocale; slug: string; updated: string }[] = [];
  // ponytail: capped at 20 pages × 500 posts; sitemap index if the blog outgrows it.
  for (let page = 1; page <= 20; page++) {
    const result = await pocketBaseFetch<List<Pick<PostRow, "locale" | "slug" | "updated">>>(listPath({
      filter: `status = "published"`, sort: "-published_at", page: String(page), perPage: "500", fields: "locale,slug,updated",
    }));
    for (const row of result.items) if (isLocale(row.locale)) out.push({ locale: row.locale, slug: row.slug, updated: fromPbDate(row.updated) ?? row.updated });
    if (page >= result.totalPages) break;
  }
  return out;
}

// ---------- Owner reads ----------

export async function listPostsForOwner(opts: { page?: number; perPage?: number; status?: BlogStatus; q?: string }): Promise<{ items: BlogPostSummary[]; page: number; totalPages: number }> {
  const filters: string[] = [];
  if (isStatus(opts.status)) filters.push(`status = ${quote(opts.status)}`);
  const q = opts.q?.trim().slice(0, 100);
  if (q) filters.push(`(title ~ ${quote(q)} || slug ~ ${quote(q)})`);
  const result = await pocketBaseFetch<List<PostRow>>(listPath({
    ...(filters.length ? { filter: filters.join(" && ") } : {}),
    sort: "-updated",
    page: String(clampInt(opts.page, 1, 10_000, 1)),
    perPage: String(clampInt(opts.perPage, 1, 100, 25)),
    fields: SUMMARY_FIELDS,
  }));
  return { items: result.items.map(toSummary), page: result.page, totalPages: result.totalPages };
}

export async function getPostForOwner(id: string): Promise<BlogPost | null> {
  if (!/^[A-Za-z0-9]{1,30}$/.test(id)) return null;
  try {
    return toPost(await pocketBaseFetch<PostRow>(recordPath(id)));
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

// ---------- Writes ----------

function text(value: unknown, field: string, max: number, required = false) {
  if (value === undefined || value === null) {
    if (required) throw new BlogInputError(field);
    return "";
  }
  if (typeof value !== "string") throw new BlogInputError(field);
  const trimmed = value.trim();
  if ((required && !trimmed) || trimmed.length > max) throw new BlogInputError(field);
  return trimmed;
}

function normalizeInput(input: BlogPostInput) {
  if (!isLocale(input.locale)) throw new BlogInputError("locale");
  if (!isStatus(input.status)) throw new BlogInputError("status");
  const title = text(input.title, "title", 160, true);
  const rawSlug = input.slug?.trim() ? slugify(input.slug) : slugify(title);
  if (!rawSlug) throw new BlogInputError("slug");
  if (input.tags !== undefined && (!Array.isArray(input.tags) || input.tags.some((tag) => typeof tag !== "string"))) throw new BlogInputError("tags");
  const tags = [...new Set((input.tags ?? []).map((tag) => tag.trim().slice(0, 40)).filter(Boolean))].slice(0, 12);
  let publishedAt: string | null = null;
  if (input.publishedAt) {
    const date = new Date(input.publishedAt);
    if (Number.isNaN(date.getTime())) throw new BlogInputError("publishedAt");
    publishedAt = date.toISOString();
  }
  // Publishing without a date stamps it now.
  if (input.status === "published" && !publishedAt) publishedAt = new Date().toISOString();
  const content = text(input.content, "content", 100_000);
  return {
    title,
    slug: rawSlug,
    locale: input.locale,
    excerpt: text(input.excerpt, "excerpt", 300),
    content,
    cover_alt: text(input.coverAlt, "coverAlt", 200),
    seo_title: text(input.seoTitle, "seoTitle", 70),
    seo_description: text(input.seoDescription, "seoDescription", 170),
    tags,
    status: input.status,
    published_at: publishedAt ? pbDate(publishedAt) : "",
    author_name: text(input.authorName, "authorName", 80),
    reading_minutes: readingMinutes(content),
  };
}

/** `base`, or `base-2`, `base-3`… when another post in the same locale already uses it. */
async function uniqueSlug(locale: BlogLocale, base: string, excludeId?: string) {
  const result = await pocketBaseFetch<List<{ id: string; slug: string }>>(listPath({
    filter: `locale = ${quote(locale)} && (slug = ${quote(base)} || slug ~ ${quote(`${base}-%`)})`,
    perPage: "500",
    skipTotal: "1",
    fields: "id,slug",
  }));
  const taken = new Set(result.items.filter((row) => row.id !== excludeId).map((row) => row.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, BLOG_SLUG_MAX - suffix.length).replace(/-+$/, "")}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function validateCover(cover: File) {
  if (!(BLOG_COVER_TYPES as readonly string[]).includes(cover.type)) throw new BlogInputError("cover");
  if (cover.size <= 0 || cover.size > BLOG_COVER_MAX_BYTES) throw new BlogInputError("cover");
}

/** JSON body, or multipart when a cover file is attached (pocketBaseFetch forces a Content-Type, so we pass the boundary ourselves). */
async function writeBody(data: Record<string, unknown>, cover: File | null | "remove" | undefined): Promise<RequestInit> {
  if (!(cover instanceof File)) return { body: JSON.stringify(cover === "remove" ? { ...data, cover: null } : data) };
  validateCover(cover);
  const form = new FormData();
  for (const [key, value] of Object.entries(data)) form.append(key, typeof value === "string" ? value : JSON.stringify(value));
  form.append("cover", cover, cover.name || "cover");
  const encoded = new Response(form);
  return { body: await encoded.arrayBuffer(), headers: { "Content-Type": encoded.headers.get("content-type") ?? "multipart/form-data" } };
}

/** Immediate expiry: an unpublished/deleted post must never be served stale (updateTag is Server-Action-only). */
function invalidate() {
  revalidateTag(BLOG_CACHE_TAG, { expire: 0 });
}

export async function createPost(input: BlogPostInput, cover?: File | null): Promise<BlogPost> {
  const data = normalizeInput(input);
  data.slug = await uniqueSlug(data.locale, data.slug);
  const row = await pocketBaseFetch<PostRow>(`/api/collections/${COLLECTION}/records`, { method: "POST", ...(await writeBody(data, cover ?? undefined)) });
  invalidate();
  return toPost(row);
}

export async function updatePost(id: string, input: Partial<BlogPostInput>, cover?: File | null | "remove"): Promise<BlogPost> {
  const current = await getPostForOwner(id);
  if (!current) throw new BlogInputError("id");
  const merged: BlogPostInput = {
    title: input.title ?? current.title,
    slug: input.slug ?? current.slug,
    locale: input.locale ?? current.locale,
    excerpt: input.excerpt ?? current.excerpt,
    content: input.content ?? current.content,
    coverAlt: input.coverAlt ?? current.coverAlt,
    seoTitle: input.seoTitle ?? current.seoTitle,
    seoDescription: input.seoDescription ?? current.seoDescription,
    tags: input.tags ?? current.tags,
    status: input.status ?? current.status,
    publishedAt: input.publishedAt !== undefined ? input.publishedAt : current.publishedAt,
    authorName: input.authorName ?? current.authorName,
  };
  const data = normalizeInput(merged);
  data.slug = await uniqueSlug(data.locale, data.slug, id);
  const row = await pocketBaseFetch<PostRow>(recordPath(id), { method: "PATCH", ...(await writeBody(data, cover ?? undefined)) });
  invalidate();
  return toPost(row);
}

export async function deletePost(id: string): Promise<void> {
  if (!/^[A-Za-z0-9]{1,30}$/.test(id)) throw new BlogInputError("id");
  await pocketBaseFetch(recordPath(id), { method: "DELETE" });
  invalidate();
}
