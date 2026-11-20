import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { BrandLogo } from "./brand-logo";
import { NotFoundSearch } from "./not-found-search";
import "./globals.css";

export const metadata: Metadata = { title: "404 | Leadta", robots: { index: false, follow: false } };

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

// ponytail: bilingüe y fuera de [locale] (sin layout ni locale conocido); carga globals.css y Geist acá para usar los tokens de marca.
// Título y texto son Server Component; el buscador de destinos (con la URL rota como consulta) es el único Client Component y se renderiza con links aun sin JS.
export default function NotFound() {
  return (
    <main className={`${geistSans.variable} grid min-h-dvh content-center bg-(--ash-100) px-4 py-8 text-(color:--ink) [font-family:var(--font-geist-sans),Arial,sans-serif]`}>
      <div className="mx-auto grid w-full max-w-[760px] gap-7">
        <div className="justify-self-start"><BrandLogo /></div>
        <div className="grid gap-4">
          <p className="m-0 w-fit rounded-full bg-(--ash-950) px-2.5 py-1 text-xs font-bold tracking-[0.06em] tabular-nums text-(color:--lime)">404</p>
          <h1 className="m-0 text-[clamp(2.5rem,1.5rem+4.2vw,4.5rem)] font-[650] leading-[1] tracking-[-0.05em] text-balance">
            Este lead se nos escapó<span className="text-(color:--lime-dark)" aria-hidden="true">.</span>
          </h1>
          <p className="m-0 max-w-[52ch] text-[17px] leading-[1.55] text-(color:--ash-700) text-pretty">
            Buscamos por todos lados y esta página no aparece: puede que el link esté mal escrito o que se haya movido.
            <span className="mt-1.5 block text-sm text-(color:--muted)" lang="en">This page slipped away. The link may be mistyped or the page moved.</span>
          </p>
        </div>
        <NotFoundSearch />
      </div>
    </main>
  );
}
