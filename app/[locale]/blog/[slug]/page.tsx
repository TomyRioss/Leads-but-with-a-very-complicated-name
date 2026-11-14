import type { Metadata } from "next";
import { Suspense } from "react";
import Image from "next/image";
import { notFound } from "next/navigation";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LandingFooter } from "@/app/landing/footer";
import type { BlogLocale, BlogPost } from "@/lib/blog";
import { extractHeadings, renderMarkdown } from "@/lib/markdown";
import { getPublishedPost, listPublishedPosts } from "@/lib/server/blog";
import { absoluteUrl, BlogCta, JsonLd, PostCard, PostMeta, safeRead, TagList, toBlogLocale } from "../blog-ui";
import { LandingHeader } from "@/app/landing/header";
import "@/app/landing/landing.css";
import "../blog.css";

type Params = Promise<{ locale: string; slug: string }>;

/**
 * Cache Components exige al menos un param para validar el shell en build (lista vacía = error).
 * El placeholder no cumple BLOG_SLUG_PATTERN: getPublishedPost devuelve null sin consultar PocketBase → 404.
 * Los slugs reales se renderizan en el primer request y quedan cacheados (cacheTag "blog").
 */
export function generateStaticParams() {
  return [{ slug: "__placeholder__" }];
}

/** Par en el otro idioma: mismo slug publicado en el otro locale (lectura cacheada). */
async function alternatePost(locale: BlogLocale, slug: string) {
  const other: BlogLocale = locale === "es" ? "en" : "es";
  return (await safeRead("alternate", () => getPublishedPost(other, slug), null)) ? other : null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, slug } = await params;
  const blogLocale = toBlogLocale(locale);
  const post = await safeRead("post", () => getPublishedPost(blogLocale, slug), null);
  if (!post) return { robots: { index: false, follow: false } };
  const url = absoluteUrl(blogLocale, `/blog/${post.slug}`);
  const other = await alternatePost(blogLocale, post.slug);
  const title = post.seoTitle || post.title;
  const description = post.seoDescription || post.excerpt;
  const images = post.coverUrl ? [{ url: post.coverUrl, alt: post.coverAlt || post.title }] : undefined;
  return {
    title,
    description,
    alternates: {
      canonical: url,
      languages: other ? { [blogLocale]: url, [other]: absoluteUrl(other, `/blog/${post.slug}`) } : undefined,
    },
    openGraph: { type: "article", url, title, description, siteName: "Leadta", locale: blogLocale, images, publishedTime: post.publishedAt ?? undefined, modifiedTime: post.updated, authors: post.authorName ? [post.authorName] : undefined, tags: post.tags },
    twitter: { card: post.coverUrl ? "summary_large_image" : "summary", title, description, images: post.coverUrl ? [post.coverUrl] : undefined },
  };
}

async function RelatedPosts({ post }: { post: BlogPost }) {
  const t = await getTranslations("blog");
  const tag = post.tags[0];
  const result = await safeRead("related", () => listPublishedPosts(post.locale, { perPage: 4, tag }), { items: [], page: 1, totalPages: 0 });
  const related = result.items.filter((item) => item.id !== post.id).slice(0, 3);
  if (!related.length) return null;
  return (
    <section className="lp-wrap blog-section blog-related" aria-labelledby="blog-related-title">
      <h2 id="blog-related-title" className="blog-section-title">{t("related")}</h2>
      <div className="blog-grid">{related.map((item) => <PostCard key={item.id} post={item} />)}</div>
    </section>
  );
}

async function Article({ params }: { params: Params }) {
  const { locale, slug } = await params;
  const blogLocale = toBlogLocale(locale);
  const post = await safeRead("post", () => getPublishedPost(blogLocale, slug), null);
  if (!post) notFound();
  const t = await getTranslations({ locale, namespace: "blog" });
  const format = await getFormatter();
  const headings = extractHeadings(post.content);
  const toc = headings.filter((heading) => heading.level === 2).length >= 3 ? headings : [];
  const url = absoluteUrl(blogLocale, `/blog/${post.slug}`);
  const showUpdated = post.publishedAt && post.updated.slice(0, 10) > post.publishedAt.slice(0, 10);

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: post.title,
      description: post.seoDescription || post.excerpt,
      image: post.coverUrl ?? undefined,
      datePublished: post.publishedAt ?? undefined,
      dateModified: post.updated,
      inLanguage: blogLocale,
      author: post.authorName ? { "@type": "Person", name: post.authorName } : { "@type": "Organization", name: "Leadta" },
      publisher: { "@type": "Organization", name: "Leadta" },
      mainEntityOfPage: url,
      keywords: post.tags.join(", ") || undefined,
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: t("home"), item: absoluteUrl(blogLocale, "/") },
        { "@type": "ListItem", position: 2, name: t("eyebrow"), item: absoluteUrl(blogLocale, "/blog") },
        { "@type": "ListItem", position: 3, name: post.title, item: url },
      ],
    },
  ];

  return (
    <>
      <JsonLd data={jsonLd} />
      <article className="blog-article">
        <div className="lp-wrap">
          <nav className="blog-breadcrumb" aria-label={t("breadcrumb")}>
            <ol>
              <li><Link href="/">{t("home")}</Link><ChevronRight size={14} aria-hidden="true" /></li>
              <li><Link href="/blog">{t("eyebrow")}</Link><ChevronRight size={14} aria-hidden="true" /></li>
              <li aria-current="page">{post.title}</li>
            </ol>
          </nav>
          <header className="blog-article-header">
            <TagList tags={post.tags} />
            <h1>{post.title}</h1>
            {post.excerpt && <p className="lp-lead">{post.excerpt}</p>}
            <div className="blog-article-byline">
              {post.authorName && <span>{t("by", { author: post.authorName })}</span>}
              <PostMeta post={post} />
              {showUpdated && <span className="blog-meta">{t("updated", { date: format.dateTime(new Date(post.updated), { day: "numeric", month: "long", year: "numeric" }) })}</span>}
            </div>
          </header>
          {post.coverUrl && (
            <figure className="blog-article-cover">
              <Image src={post.coverUrl} alt={post.coverAlt || ""} fill priority unoptimized sizes="(min-width: 1200px) 1100px, 100vw" />
            </figure>
          )}
          <div className={`blog-article-layout${toc.length ? " has-toc" : ""}`}>
            {toc.length > 0 && (
              <nav className="blog-toc" aria-labelledby="blog-toc-title">
                <p id="blog-toc-title">{t("toc")}</p>
                <ol>{toc.map((heading) => <li key={heading.id} className={heading.level === 3 ? "is-sub" : undefined}><a href={`#${heading.id}`}>{heading.text}</a></li>)}</ol>
              </nav>
            )}
            <div className="blog-prose">{renderMarkdown(post.content)}</div>
          </div>
          <p className="blog-back"><Link href="/blog"><ArrowLeft size={16} aria-hidden="true" />{t("backToBlog")}</Link></p>
        </div>
      </article>
      <RelatedPosts post={post} />
    </>
  );
}

export default async function BlogPostPage({ params }: { params: Params }) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  // Antes del primer byte: notFound() dentro de Suspense ya no puede cambiar el status (quedaría 200).
  if (!(await safeRead("post", () => getPublishedPost(toBlogLocale(locale), slug), null))) notFound();
  const t = await getTranslations({ locale, namespace: "blog" });
  return (
    <div className="lp-page blog-page">
      <LandingHeader current="blog" />
      <main className="blog-main">
        {/* Slugs fuera de generateStaticParams son dato de request: Suspense deja prerenderizar el shell. */}
        <Suspense fallback={<p role="status" className="lp-wrap blog-loading">{t("loading")}</p>}>
          <Article params={params} />
        </Suspense>
      </main>
      <BlogCta />
      <LandingFooter />
    </div>
  );
}
