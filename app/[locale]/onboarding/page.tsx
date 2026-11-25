import type { Metadata } from "next";
import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { OnboardingFallback, OnboardingFlow } from "./onboarding-flow";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "BusinessOnboarding" });
  return { title: t("meta.title"), robots: { index: false, follow: false } };
}

// Shell estático: ?business= / ?new=1 se leen en el cliente (useSearchParams dentro de Suspense); sesión y datos, también.
export default async function OnboardingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense fallback={<OnboardingFallback />}>
      <OnboardingFlow />
    </Suspense>
  );
}
