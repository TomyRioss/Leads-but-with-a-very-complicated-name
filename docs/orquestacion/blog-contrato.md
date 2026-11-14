# Blog: contrato compartido (ORQ-1-0103 a 0106)

Blog público en `/blog` (y `/blog/[slug]`), accesible desde la landing, simple y muy estético, administrable desde el panel owner, indexable (SEO). El usuario autorizó ESCRIBIR una migración nueva (no ejecutarla).

## Datos: `pb_migrations/1794370000_add_blog_posts.js`
Colección `blog_posts` (base): `title` (text, req, max 160), `slug` (text, req, único, `^[a-z0-9]+(?:-[a-z0-9]+)*$`, max 120), `locale` (select es|en, req), `excerpt` (text, max 300), `content` (text largo: Markdown, max 100000), `cover` (file, 1, imágenes jpg/png/webp, max 5MB), `cover_alt` (text, max 200), `seo_title` (text, max 70), `seo_description` (text, max 170), `tags` (json, array de strings), `status` (select draft|published, req), `published_at` (date), `author_name` (text, max 80), `reading_minutes` (number), `created`/`updated` autodate. Índices: único `(locale, slug)`, `(status, locale, published_at)`. Reglas: list/view públicas SOLO `status = "published"`; create/update/delete `null` (solo servidor).

## Tipos: `lib/blog.ts` (sin imports de servidor)
```ts
export type BlogLocale = "es" | "en";
export type BlogStatus = "draft" | "published";
export interface BlogPost { id: string; title: string; slug: string; locale: BlogLocale; excerpt: string; content: string; coverUrl: string | null; coverAlt: string; seoTitle: string; seoDescription: string; tags: string[]; status: BlogStatus; publishedAt: string | null; authorName: string; readingMinutes: number; updated: string; }
export type BlogPostSummary = Omit<BlogPost, "content">;
export interface BlogPostInput { title: string; slug?: string; locale: BlogLocale; excerpt?: string; content: string; coverAlt?: string; seoTitle?: string; seoDescription?: string; tags?: string[]; status: BlogStatus; publishedAt?: string | null; authorName?: string; }
export function slugify(text: string): string;
export function readingMinutes(markdown: string): number;
```

## Repositorio: `lib/server/blog.ts`
```ts
export async function listPublishedPosts(locale: BlogLocale, opts?: { page?: number; perPage?: number; tag?: string }): Promise<{ items: BlogPostSummary[]; page: number; totalPages: number }>;
export async function getPublishedPost(locale: BlogLocale, slug: string): Promise<BlogPost | null>;
export async function listAllPublishedSlugs(): Promise<{ locale: BlogLocale; slug: string; updated: string }[]>; // para sitemap
export async function listPostsForOwner(opts: { page?: number; perPage?: number; status?: BlogStatus; q?: string }): Promise<{ items: BlogPostSummary[]; page: number; totalPages: number }>;
export async function getPostForOwner(id: string): Promise<BlogPost | null>;
export async function createPost(input: BlogPostInput, cover?: File | null): Promise<BlogPost>;
export async function updatePost(id: string, input: Partial<BlogPostInput>, cover?: File | null | "remove"): Promise<BlogPost>;
export async function deletePost(id: string): Promise<void>;
```
Lecturas públicas cacheables (Next 16: `"use cache"` + `cacheTag("blog")` / `cacheLife`, leé node_modules/next/dist/docs/); escrituras invalidan con `revalidateTag("blog")` (o `updateTag`, según docs de la versión).

## API owner: `app/api/owner/blog/route.ts` (GET lista, POST crear) y `app/api/owner/blog/[id]/route.ts` (GET, PATCH, DELETE)
Auth owner con el mismo guard que las demás rutas de app/api/owner (`_shared.ts`), multipart para portada, validación, errores con el patrón existente, auditoría con owner-audit si existe el patrón. Respuestas: `{ post: BlogPost }`, `{ items, page, totalPages }`, `{ ok: true }`.

## Rutas públicas
`/[locale]/blog` (índice paginado, filtro por tag opcional) y `/[locale]/blog/[slug]` (Markdown renderizado seguro, sin HTML crudo del autor o sanitizado). Metadata por post (title, description, canonical, hreflang si existe el par, OG/Twitter con portada), JSON-LD `BlogPosting` + `BreadcrumbList`.

## i18n
Namespace `blog` en `messages/blog/{es,en}.json` (dueño 0105) registrado en `i18n/request.ts` (dueño 0105). Textos del admin en `messages/owner/{es,en}.json` (dueño 0104).

## UI
Paleta y Geist de AGENTS.md, iconos lucide-react, sin SVG a mano, responsive móvil primero, accesible.
