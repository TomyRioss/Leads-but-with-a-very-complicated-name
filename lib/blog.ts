export type BlogLocale = "es" | "en";
export type BlogStatus = "draft" | "published";
export interface BlogPost { id: string; title: string; slug: string; locale: BlogLocale; excerpt: string; content: string; coverUrl: string | null; coverAlt: string; seoTitle: string; seoDescription: string; tags: string[]; status: BlogStatus; publishedAt: string | null; authorName: string; readingMinutes: number; updated: string; }
export type BlogPostSummary = Omit<BlogPost, "content">;
export interface BlogPostInput { title: string; slug?: string; locale: BlogLocale; excerpt?: string; content: string; coverAlt?: string; seoTitle?: string; seoDescription?: string; tags?: string[]; status: BlogStatus; publishedAt?: string | null; authorName?: string; }

export const BLOG_LOCALES: readonly BlogLocale[] = ["es", "en"];
export const BLOG_STATUSES: readonly BlogStatus[] = ["draft", "published"];
export const BLOG_SLUG_MAX = 120;
export const BLOG_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** "Cómo vender más: guía 2026 ñandú" → "como-vender-mas-guia-2026-nandu". */
export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " y ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, BLOG_SLUG_MAX)
    .replace(/-+$/g, "");
}

/** Minutes at 220 wpm, ignoring Markdown syntax, code fences and URLs; minimum 1. */
export function readingMinutes(markdown: string): number {
  const text = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[#>*_`~|-]/g, " ");
  const words = text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
  return Math.max(1, Math.ceil(words / 220));
}
