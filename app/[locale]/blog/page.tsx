import type { Metadata } from "next";
import { Suspense } from "react";
import { ArrowLeft, ArrowRight, Newspaper } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LandingFooter } from "@/app/landing/footer";
import { listPublishedPosts } from "@/lib/server/blog";
import { absoluteUrl, BlogCta, JsonLd, PostCard, safeRead, toBlogLocale } from "./blog-ui";
import { LandingHeader } from "@/app/landing/header";
import "@/app/landing/landing.css";
import "./blog.css";

const PER_PAGE = 9;
const emptyList = { items: [], page: 1, totalPages: 0 };

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "blog" });
  const url = absoluteUrl(toBlogLocale(locale), "/blog");
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: { canonical: url, languages: { es: absoluteUrl("es", "/blog"), en: absoluteUrl("en", "/blog"), "x-default": absoluteUrl("es", "/blog") } },
    openGraph: { type: "website", url, title: t("metaTitle"), description: t("metaDescription"), siteName: "Leadta" },
    twitter: { card: "summary_large_image", title: t("metaTitle"), description: t("metaDescription") },
  };
}

function pageNumber(value: string | string[] | undefined) {
  const parsed = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 10_000 ? parsed : 1;
}

function tagParam(value: string | string[] | undefined) {
  const tag = (Array.isArray(value) ? value[0] : value)?.trim().slice(0, 60);
  return tag || undefined;
}

async function PostList({ locale, searchParams }: { locale: string; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const page = pageNumber(query.page);
  const tag = tagParam(query.tag);
  const blogLocale = toBlogLocale(locale);
  const t = await getTranslations({ locale, namespace: "blog" });
  // Las dos lecturas son cacheadas ("use cache" en el repositorio) e independientes: en paralelo.
  const [result, tagSource] = await Promise.all([
    safeRead("list", () => listPublishedPosts(blogLocale, { page, perPage: PER_PAGE, tag }), emptyList),
    safeRead("tags", () => listPublishedPosts(blogLocale, { page: 1, perPage: 50 }), emptyList),
  ]);
  // ponytail: los tags del filtro salen de los últimos 50 posts; si el blog crece mucho, exponer una lista de tags en el repositorio.
  const tags = [...new Set(tagSource.items.flatMap((post) => post.tags))].slice(0, 20);
  const showFeatured = page === 1 && !tag && result.items.length > 0;
  const [featured, ...rest] = showFeatured ? result.items : [null, ...result.items];

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Blog",
    name: t("metaTitle"),
    description: t("metaDescription"),
    url: absoluteUrl(blogLocale, "/blog"),
    inLanguage: blogLocale,
    blogPost: result.items.map((post) => ({ "@type": "BlogPosting", headline: post.title, url: absoluteUrl(blogLocale, `/blog/${post.slug}`), datePublished: post.publishedAt ?? undefined, image: post.coverUrl ?? undefined })),
  };

  return (
    <>
      <JsonLd data={jsonLd} />
      {tags.length > 0 && (
        <nav className="blog-filter" aria-label={t("filterLabel")}>
          <Link href="/blog" aria-current={!tag ? "page" : undefined}>{t("allTags")}</Link>
          {tags.map((item) => <Link key={item} href={{ pathname: "/blog", query: { tag: item } }} aria-current={item === tag ? "page" : undefined}>{item}</Link>)}
        </nav>
      )}

      {result.items.length === 0 ? (
        <div className="blog-empty">
          <Newspaper size={28} aria-hidden="true" />
          <h2>{tag ? t("emptyTagTitle") : t("emptyTitle")}</h2>
          {tag
            ? <Link className="lp-btn lp-btn-ghost" href="/blog">{t("emptyTagLink")}</Link>
            : <><p>{t("emptyText")}</p><Link className="lp-btn lp-btn-ink" href="/buscar?signup=1">{t("ctaPrimary")} <ArrowRight size={17} aria-hidden="true" /></Link></>}
        </div>
      ) : (
        <>
          {featured && <PostCard post={featured} featured headingLevel="h2" />}
          {rest.length > 0 && (
            <section className="blog-section" aria-labelledby="blog-latest">
              <h2 id="blog-latest" className="blog-section-title">{tag ? t("taggedWith", { tag }) : t("latest")}</h2>
              <div className="blog-grid">{rest.map((post) => post && <PostCard key={post.id} post={post} />)}</div>
            </section>
          )}
          {result.totalPages > 1 && (
            <nav className="blog-pagination" aria-label={t("pagination")}>
              {page > 1
                ? <Link className="lp-btn lp-btn-ghost lp-btn-sm" href={{ pathname: "/blog", query: { ...(tag ? { tag } : {}), ...(page > 2 ? { page: page - 1 } : {}) } }} rel="prev"><ArrowLeft size={16} aria-hidden="true" />{t("previous")}</Link>
                : <span />}
              <span className="blog-pagination-status">{t("pageOf", { page, total: result.totalPages })}</span>
              {page < result.totalPages
                ? <Link className="lp-btn lp-btn-ghost lp-btn-sm" href={{ pathname: "/blog", query: { ...(tag ? { tag } : {}), page: page + 1 } }} rel="next">{t("next")}<ArrowRight size={16} aria-hidden="true" /></Link>
                : <span />}
            </nav>
          )}
        </>
      )}
    </>
  );
}

export default async function BlogIndexPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "blog" });
  return (
    <div className="lp-page blog-page">
      <LandingHeader current="blog" />
      <main className="lp-wrap blog-main">
        <header className="blog-hero">
          <span className="blog-eyebrow">{t("eyebrow")}</span>
          <h1>{t("heroTitle")}<span className="brand-dot" aria-hidden="true">.</span></h1>
          <p className="lp-lead">{t("heroText")}</p>
        </header>
        {/* searchParams (tag/página) es dato de request: va dentro de Suspense para que el hero se prerenderice. */}
        <Suspense fallback={<p role="status" className="blog-loading">{t("loading")}</p>}>
          <PostList locale={locale} searchParams={searchParams} />
        </Suspense>
      </main>
      <BlogCta />
      <LandingFooter />
    </div>
  );
}
