"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

type BrandMarkProps = { className?: string };

export function BrandMark({ className = "" }: BrandMarkProps) {
  return (
    <span className={`brand-mark ${className}`.trim()} aria-hidden="true">
      Lt<span className="brand-mark-dot" />
    </span>
  );
}

export function BrandLogo() {
  // ponytail: href por locale con useParams; el Link de next-intl exige NextIntlClientProvider y app/not-found.tsx (raíz) no lo tiene.
  const { locale } = useParams<{ locale?: string }>();
  return (
    <Link className="brand" href={locale === "en" ? "/en" : "/"} aria-label="Leadta, inicio">
      <span aria-hidden="true">
        Leadta<span className="brand-period">.</span>
      </span>
    </Link>
  );
}
