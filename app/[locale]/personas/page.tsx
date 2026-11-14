import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PeopleSearch } from "./people-search";
import "./personas.css";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "people" });
  return { title: t("title"), robots: { index: false, follow: false } };
}

// Shell estático: sesión y datos se piden en el cliente (/api/auth/me, /api/people/*), igual que lead-suite.
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <PeopleSearch />;
}
