import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { isDevFeatureEnabled } from "@/lib/env-features";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function PrivateLayout({ children }: { children: ReactNode }) {
  // Dev feature `people_search`: hidden in production until it launches.
  if (!isDevFeatureEnabled("people_search")) notFound();
  return children;
}
