import type { Metadata } from "next";
import { LegalPage, legalMetadata } from "./legal-page";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return legalMetadata((await params).locale, "termsPage");
}

export default async function TermsPage({ params }: { params: Promise<{ locale: string }> }) {
  return <LegalPage locale={(await params).locale} kind="termsPage" />;
}
