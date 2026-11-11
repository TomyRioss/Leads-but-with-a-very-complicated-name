import type { Metadata } from "next";
import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import OwnerPanel from "./owner-panel";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Owner.meta" });
  return { title: t("title"), robots: { index: false, follow: false } };
}

// The panel reads the active section with useSearchParams(), which must sit inside Suspense.
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Owner.common");
  return (
    <Suspense fallback={<main className="grid min-h-dvh place-items-center bg-(--ash-100) text-(color:--muted)"><p role="status" className="text-[13px]">{t("loading")}</p></main>}>
      <OwnerPanel />
    </Suspense>
  );
}
