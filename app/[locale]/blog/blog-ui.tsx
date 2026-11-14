import Image from "next/image";
import { ArrowRight, Clock } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { BlogLocale, BlogPostSummary } from "@/lib/blog";
import { localizedPath } from "@/lib/server/locale";

/** URL absoluta del sitio, mismo criterio que los emails (APP_URL o leadta.app en Vercel). */
export function siteUrl() {
  return (process.env.APP_URL?.trim() || (process.env.VERCEL ? "https://leadta.app" : "http://localhost:3000")).replace(/\/$/, "");
}

export function absoluteUrl(locale: BlogLocale, path: string) {
  return `${siteUrl()}${localizedPath(locale, path)}`;
}

/** Lecturas públicas que no rompen la página si PocketBase falla o falta la colección: loguea y devuelve el fallback. */
export async function safeRead<T>(label: string, read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read();
  } catch (error) {
    console.error(`Blog ${label} failed:`, error instanceof Error ? error.name : "unknown", (error as { status?: number })?.status ?? "");
    return fallback;
  }
}

export function toBlogLocale(locale: string): BlogLocale {
  return locale === "en" ? "en" : "es";
}

export function JsonLd({ data }: { data: unknown }) {
  // JSON.stringify + escape de "<" evita cerrar el <script> desde contenido del post.
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}

export async function BlogCta() {
  const t = await getTranslations("blog");
  return (
    <section className="lp-final blog-cta" aria-labelledby="blog-cta-title">
      <div className="lp-wrap lp-final-inner">
        <div>
          <h2 id="blog-cta-title">{t("ctaTitle")}</h2>
          <p>{t("ctaText")}</p>
        </div>
        <div className="lp-final-actions">
          <Link className="lp-btn lp-btn-ink" href="/buscar?signup=1">{t("ctaPrimary")} <ArrowRight size={17} aria-hidden="true" /></Link>
          <Link className="lp-final-link" href="/buscar">{t("ctaSecondary")}</Link>
        </div>
      </div>
    </section>
  );
}

export async function PostMeta({ post }: { post: Pick<BlogPostSummary, "publishedAt" | "readingMinutes"> }) {
  const t = await getTranslations("blog");
  const format = await getFormatter();
  return (
    <p className="blog-meta">
      {post.publishedAt && <time dateTime={post.publishedAt}>{format.dateTime(new Date(post.publishedAt), { day: "numeric", month: "long", year: "numeric" })}</time>}
      {post.publishedAt && post.readingMinutes > 0 && <span aria-hidden="true">·</span>}
      {post.readingMinutes > 0 && <span className="blog-meta-read"><Clock size={14} aria-hidden="true" />{t("readingMinutes", { minutes: post.readingMinutes })}</span>}
    </p>
  );
}

export function TagList({ tags }: { tags: string[] }) {
  if (!tags.length) return null;
  return (
    <ul className="blog-tags">
      {tags.slice(0, 4).map((tag) => <li key={tag}><Link href={{ pathname: "/blog", query: { tag } }}>{tag}</Link></li>)}
    </ul>
  );
}

export async function PostCard({ post, featured = false, headingLevel = "h3" }: { post: BlogPostSummary; featured?: boolean; headingLevel?: "h2" | "h3" }) {
  const t = await getTranslations("blog");
  const Heading = headingLevel;
  return (
    <article className={`blog-card${featured ? " blog-card-featured" : ""}`}>
      <Link href={`/blog/${post.slug}`} className="blog-card-cover" tabIndex={-1} aria-hidden="true">
        {post.coverUrl
          ? <Image src={post.coverUrl} alt="" fill unoptimized sizes={featured ? "(min-width: 900px) 60vw, 100vw" : "(min-width: 900px) 33vw, 100vw"} />
          : <span className="blog-card-cover-fallback">{post.title.slice(0, 1)}</span>}
      </Link>
      <div className="blog-card-body">
        {featured && <span className="blog-eyebrow">{t("featured")}</span>}
        <Heading className="blog-card-title"><Link href={`/blog/${post.slug}`}>{post.title}</Link></Heading>
        {post.excerpt && <p className="blog-card-excerpt">{post.excerpt}</p>}
        <PostMeta post={post} />
        <TagList tags={post.tags} />
      </div>
    </article>
  );
}
