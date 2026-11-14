import type { MetadataRoute } from "next";
import { listAllPublishedSlugs } from "@/lib/server/blog";

const origin = new URL(process.env.APP_URL?.trim() || "https://leadta.app").origin;
// localePrefix "as-needed": español sin prefijo, inglés bajo /en.
const url = (locale: string, path: string) => `${origin}${locale === "es" ? "" : "/en"}${path === "/" && locale !== "es" ? "" : path}`;

function localized(path: string, priority: number): MetadataRoute.Sitemap[number] {
  return {
    url: url("es", path),
    changeFrequency: "weekly",
    priority,
    alternates: { languages: { es: url("es", path), en: url("en", path), "x-default": url("es", path) } },
  };
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pages = [localized("/", 1), localized("/pricing", 0.8), localized("/blog", 0.7), localized("/terminos", 0.3), localized("/privacidad", 0.3)];
  let posts: MetadataRoute.Sitemap = [];
  try {
    posts = (await listAllPublishedSlugs()).map((post) => ({
      url: url(post.locale, `/blog/${encodeURIComponent(post.slug)}`),
      lastModified: post.updated,
      changeFrequency: "monthly",
      priority: 0.6,
    }));
  } catch (error) {
    // ponytail: sin el blog el sitemap igual publica las páginas fijas.
    console.error("[sitemap] blog unavailable", error instanceof Error ? error.message : error);
  }
  return [...pages, ...posts];
}
