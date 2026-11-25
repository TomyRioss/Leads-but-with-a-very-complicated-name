import type { Metadata } from "next";
import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LoadingState, WorkspaceShell } from "@/app/workspace/workspace-ui";
import { CampaignsView } from "./campaigns-view";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Workspace.campaigns" });
  return { title: t("pageTitle"), robots: { index: false, follow: false } };
}

// Shell estático: ?business= se lee en el cliente (useSearchParams dentro de Suspense) y los datos se piden ahí.
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Workspace.campaigns" });
  return (
    <WorkspaceShell active="campaigns">
      <Suspense fallback={<LoadingState label={t("loading")} />}>
        <CampaignsView />
      </Suspense>
    </WorkspaceShell>
  );
}
