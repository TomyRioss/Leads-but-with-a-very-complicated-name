import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { WorkspaceShell } from "@/app/workspace/workspace-ui";
import { BusinessesView } from "./businesses-view";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Workspace.businesses" });
  return { title: t("pageTitle"), robots: { index: false, follow: false } };
}

// Shell estático: la sesión (/api/auth/me) y los datos (/api/businesses) se piden en el cliente.
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <WorkspaceShell active="businesses">
      <BusinessesView />
    </WorkspaceShell>
  );
}
