import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ExploreShell } from "./explore-shell";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Explore" });
  return { title: t("meta.title"), robots: { index: false, follow: false } };
}

// Shell estático: la exploración (cookie del navegador) se pide en el cliente a /api/explore.
export default async function ExplorePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ExploreShell />;
}
