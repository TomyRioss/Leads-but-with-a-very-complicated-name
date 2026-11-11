import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Geist } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import esMessages from "@/messages/es.json";
import enMessages from "@/messages/en.json";
import "react-phone-number-input/style.css";
import "../globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return locale === "en"
    ? { title: "Leadta | Local lead finder", description: "Find local businesses by keyword and area, save your leads, and export them to CSV." }
    : { title: "Leadta | Buscador de leads", description: "Generá leads locales por keyword y zona, guardalos y descargalos en CSV." };
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function RootLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  return (
    <html
      lang={locale}
      className={`${geistSans.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider
          locale={locale}
          messages={locale === "es" ? esMessages : enMessages}
          formats={{}}
          now={new Date("2026-01-01T00:00:00.000Z")}
          timeZone="UTC"
        >
          {children}
        </NextIntlClientProvider>
        <Analytics />
      </body>
    </html>
  );
}
