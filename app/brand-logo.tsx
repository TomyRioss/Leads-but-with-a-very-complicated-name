"use client";

import Link from "next/link";

type BrandMarkProps = { className?: string };

export function BrandMark({ className = "" }: BrandMarkProps) {
  return (
    <span className={`brand-mark ${className}`.trim()} aria-hidden="true">
      Lt<span className="brand-period" />
    </span>
  );
}

export function BrandLogo() {
  return (
    <Link className="brand" href="/" aria-label="Leadta, inicio">
      <span aria-hidden="true">
        leadta<span className="brand-period" />
      </span>
    </Link>
  );
}
