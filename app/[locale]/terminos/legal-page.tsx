import type { Metadata } from "next";
import { Fragment } from "react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LandingFooter } from "@/app/landing/footer";
import { LandingHeader } from "@/app/landing/header";
import "@/app/landing/landing.css";
import "../blog/blog.css";

export type LegalKind = "termsPage" | "privacyPage";

type Section = { h: string; p: string[]; limitedUse?: boolean };

const paths: Record<LegalKind, string> = { termsPage: "/terminos", privacyPage: "/privacidad" };
const policyUrl = "https://developers.google.com/terms/api-services-user-data-policy";

export async function legalMetadata(locale: string, kind: LegalKind): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: `Legal.${kind}` });
  const path = paths[kind];
  const url = locale === "es" ? path : `/${locale}${path}`;
  return {
    title: `${t("title")} | Leadta`,
    description: t("description"),
    alternates: { canonical: url, languages: { es: path, en: `/en${path}`, "x-default": path } },
    openGraph: { type: "article", siteName: "Leadta", url, title: `${t("title")} | Leadta`, description: t("description") },
  };
}

/** Página legal estática con la prosa del blog; el contenido vive en messages/legal. */
export async function LegalPage({ locale, kind }: { locale: string; kind: LegalKind }) {
  setRequestLocale(locale);
  const [t, page, format] = await Promise.all([
    getTranslations({ locale, namespace: "Legal" }),
    getTranslations({ locale, namespace: `Legal.${kind}` }),
    getFormatter({ locale }),
  ]);
  const sections = page.raw("sections") as Section[];
  const other: LegalKind = kind === "termsPage" ? "privacyPage" : "termsPage";
  const updated = format.dateTime(new Date(`${t("updatedDate")}T12:00:00Z`), { day: "numeric", month: "long", year: "numeric" });
  return (
    <div className="lp-page blog-page">
      <LandingHeader current="other" />
      <main className="blog-main">
        <article className="lp-wrap blog-article">
          <header className="blog-article-header">
            <p className="blog-meta">{t("breadcrumb")}</p>
            <h1>{page("title")}</h1>
            <p className="blog-meta">{t("updated", { date: updated })}</p>
          </header>
          <div className="blog-article-layout">
            <div className="blog-prose">
              <p>{page("intro")}</p>
              {sections.map((section) => (
                <Fragment key={section.h}>
                  <h2>{section.h}</h2>
                  {section.p.map((text) => <p key={text}>{text}</p>)}
                  {section.limitedUse && (
                    <blockquote>
                      <p><strong>{t("limitedUse.lead")}</strong> {t("limitedUse.statement")}</p>
                      {t("limitedUse.translation") && <p>{t("limitedUse.translation")}</p>}
                      <p><a href={policyUrl} target="_blank" rel="noopener noreferrer">{t("limitedUse.link")}</a></p>
                    </blockquote>
                  )}
                </Fragment>
              ))}
              <p>{t("related")}: <Link href={paths[other]}>{t(other === "termsPage" ? "terms" : "privacy")}</Link></p>
            </div>
          </div>
        </article>
      </main>
      <LandingFooter />
    </div>
  );
}
