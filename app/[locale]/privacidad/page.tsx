import type { Metadata } from "next";
import { LegalPage, legalMetadata } from "../terminos/legal-page";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return legalMetadata((await params).locale, "privacyPage");
}

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  return <LegalPage locale={(await params).locale} kind="privacyPage" />;
}
