import type { MetadataRoute } from "next";
import { listAllPublishedSlugs } from "@/lib/server/blog";

const origin = new URL(process.env.APP_URL?.trim() || "https://leadta.app").origin;
// localePrefix "as-needed": español sin prefijo, inglés bajo /en.
const url = (locale: string, path: string) => `${origin}${locale === "es" ? "" : "/en"}${path === "/" && locale !== "es" ? "" : path}`;
// Fecha fija (no new Date() por request): subirla cuando cambie el contenido de las páginas fijas.
const STATIC_LAST_MODIFIED = new Date("2026-11-27");

const languages = (path: string) => ({ es: url("es", path), en: url("en", path), "x-default": url("es", path) });

// Una entrada por idioma, ambas con el mismo bloque hreflang.
function localized(path: string, priority: number): MetadataRoute.Sitemap {
  const alternates = { languages: languages(path) };
  return (["es", "en"] as const).map((locale) => ({
    url: url(locale, path),
    lastModified: STATIC_LAST_MODIFIED,
    changeFrequency: "weekly",
    priority,
    alternates,
  }));
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pages = [localized("/", 1), localized("/pricing", 0.8), localized("/blog", 0.7), localized("/terminos", 0.3), localized("/privacidad", 0.3)].flat();
  let posts: MetadataRoute.Sitemap = [];
  try {
    const all = await listAllPublishedSlugs();
    const keys = new Set(all.map((post) => `${post.locale}:${post.slug}`));
    posts = all.map((post) => {
      const path = `/blog/${encodeURIComponent(post.slug)}`;
      // hreflang solo si el slug existe en ambos idiomas.
      const both = keys.has(`es:${post.slug}`) && keys.has(`en:${post.slug}`);
      return {
        url: url(post.locale, path),
        lastModified: post.updated,
        changeFrequency: "monthly",
        priority: 0.6,
        ...(both && { alternates: { languages: languages(path) } }),
      };
    });
  } catch (error) {
    // ponytail: sin el blog el sitemap igual publica las páginas fijas.
    console.error("[sitemap] blog unavailable", error instanceof Error ? error.message : error);
  }
  return [...pages, ...posts];
}
