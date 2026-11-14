import type { Metadata } from "next";
import Link from "next/link";
import { Geist } from "next/font/google";
import { ArrowRight, Newspaper, Search, Sparkles } from "lucide-react";
import { BrandLogo } from "./brand-logo";
import { NotFoundGame } from "./not-found-game";
import "./globals.css";
import "./not-found.css";

export const metadata: Metadata = { title: "404 | Leadta", robots: { index: false, follow: false } };

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

// ponytail: bilingüe y fuera de [locale] (sin layout ni locale conocido); carga globals.css y Geist acá para usar los tokens de marca.
// El contenido y los links son Server Component (funcionan sin JS); el radar interactivo es el único Client Component.
export default function NotFound() {
  return (
    <main className={`nf-page ${geistSans.variable}`}>
      <div className="nf-inner">
        <div className="nf-copy">
          <BrandLogo />
          <p className="nf-badge">404</p>
          <h1 className="nf-title">Este lead se nos escapó<span className="nf-dot" aria-hidden="true">.</span></h1>
          <p className="nf-text">
            Buscamos por todos lados y esta página no aparece: puede que el link esté mal escrito o que se haya movido.
            <span className="nf-en" lang="en">This page slipped away. The link may be mistyped or the page moved.</span>
          </p>
          <ul className="nf-links">
            <li><Link className="nf-link nf-link-primary" href="/">Ir al inicio <ArrowRight size={18} aria-hidden="true" /></Link></li>
            <li><Link className="nf-link" href="/buscar"><Search size={18} aria-hidden="true" />Buscar leads</Link></li>
            <li><Link className="nf-link" href="/leadtita"><Sparkles size={18} aria-hidden="true" />Leadtita</Link></li>
            <li><Link className="nf-link" href="/blog"><Newspaper size={18} aria-hidden="true" />Blog</Link></li>
          </ul>
        </div>
        <NotFoundGame />
      </div>
    </main>
  );
}
