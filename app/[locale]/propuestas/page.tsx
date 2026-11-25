import type { Metadata } from "next";
import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LoadingState, WorkspaceShell } from "@/app/workspace/workspace-ui";
import { ProposalsView } from "./proposals-view";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Workspace.proposals" });
  return { title: t("pageTitle"), robots: { index: false, follow: false } };
}

// Shell estático: ?campaign= / ?business= se leen en el cliente (useSearchParams dentro de Suspense).
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Workspace.proposals" });
  return (
    <WorkspaceShell active="proposals">
      <Suspense fallback={<LoadingState label={t("loading")} />}>
        <ProposalsView />
      </Suspense>
    </WorkspaceShell>
  );
}
