"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowRight, Search } from "lucide-react";

type Dest = { href: string; label: string; desc: string; keys: string };

const COPY = {
  es: {
    label: "Buscar una página de Leadta",
    placeholder: "Escribe a dónde querías ir",
    none: "0 resultados",
    count: (n: number) => `${n} ${n === 1 ? "destino" : "destinos"}`,
    didYouMean: "¿Quisiste decir…?",
    all: "Destinos",
    noMatch: "Nada coincide con eso. Estos son todos los destinos.",
    dests: [
      { href: "/negocios", label: "Mis negocios", desc: "Tus negocios, campañas y propuestas", keys: "negocios campañas propuestas buscar leads prospectos" },
      { href: "/leadtita", label: "Leadtita", desc: "Tu asistente de Leadta", keys: "leadtita asistente ia chat panel" },
      { href: "/blog", label: "Blog", desc: "Guías y novedades", keys: "blog articulos guias novedades noticias" },
      { href: "/", label: "Inicio", desc: "Volver a la página principal", keys: "inicio home principal landing leadta" },
    ] satisfies Dest[],
  },
  en: {
    label: "Search a Leadta page",
    placeholder: "Type where you wanted to go",
    none: "0 results",
    count: (n: number) => `${n} ${n === 1 ? "destination" : "destinations"}`,
    didYouMean: "Did you mean…?",
    all: "Destinations",
    noMatch: "Nothing matches that. Here are all destinations.",
    dests: [
      { href: "/negocios", label: "My businesses", desc: "Your businesses, campaigns and proposals", keys: "businesses campaigns proposals search leads prospects" },
      { href: "/leadtita", label: "Leadtita", desc: "Your Leadta assistant", keys: "leadtita assistant ai chat panel" },
      { href: "/blog", label: "Blog", desc: "Guides and news", keys: "blog articles guides news" },
      { href: "/", label: "Home", desc: "Back to the main page", keys: "home start main landing leadta" },
    ] satisfies Dest[],
  },
};

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// Puntaje = cuántas palabras de la consulta aparecen en las claves del destino. Con la URL rota intacta sirve como "¿quisiste decir?".
function rank(query: string, dests: Dest[]) {
  const tokens = norm(query).split(/[^a-z0-9]+/).filter((w) => w.length >= 2);
  const scored = dests.map((d, i) => ({ d, i, score: tokens.filter((w) => norm(`${d.href} ${d.keys}`).includes(w)).length }));
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored;
}

const ring = "focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-(--ash-950)";

// ponytail: el único estado es el texto del input; la lista se deriva. Sin JS la lista completa queda renderizada como links.
export function NotFoundSearch() {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const t = pathname === "/en" || pathname.startsWith("/en/") ? COPY.en : COPY.es;
  const [value, setValue] = useState(pathname);

  const untouched = value === pathname;
  const scored = rank(value, t.dests);
  const matches = scored.filter((s) => s.score > 0);
  const noMatch = !untouched && value.trim() !== "" && matches.length === 0;
  const list = untouched || noMatch || matches.length === 0 ? scored : matches;
  const hasBest = list[0].score > 0;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <form
        role="search"
        className="flex h-16 items-center gap-3 rounded-2xl bg-(--ash-950) pr-3 pl-5 focus-within:outline-3 focus-within:outline-offset-3 focus-within:outline-(--lime-dark) max-[420px]:h-14 max-[420px]:pl-4"
        onSubmit={(event) => {
          event.preventDefault();
          router.push(list[0].d.href);
        }}
      >
        <Search size={22} className="flex-none text-(color:--lime)" aria-hidden="true" />
        <label htmlFor="nf-search" className="sr-only">{t.label}</label>
        <input
          id="nf-search"
          type="text"
          value={value}
          placeholder={t.placeholder}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setValue(event.target.value)}
          className="h-full min-w-0 flex-1 border-0 bg-transparent font-mono text-lg text-(color:--lime) caret-(--lime) outline-none placeholder:text-(color:--ash-500) max-[420px]:text-base"
        />
        <span
          className={`flex-none rounded-lg px-2.5 py-1 text-[13px] font-bold tabular-nums ${untouched ? "bg-(--ash-800) text-(color:--ash-200)" : "bg-(--lime) text-(color:--ash-950)"}`}
          role="status"
          aria-live="polite"
        >
          {untouched ? t.none : t.count(list.length)}
        </span>
      </form>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-2.5">
        <p className="m-0 text-sm font-bold text-(color:--ash-700)">
          {noMatch ? t.noMatch : untouched && hasBest ? t.didYouMean : t.all}
        </p>
        <ul className="m-0 grid list-none gap-2 p-0">
          {list.map(({ d }, i) => {
            const best = i === 0 && hasBest;
            return (
              <li key={d.href}>
                <Link
                  href={d.href}
                  className={`group grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border px-4 py-3 text-(color:--ink) no-underline transition-colors duration-150 ${ring} ${
                    best
                      ? "border-(color:--lime-dark) bg-(--lime) hover:bg-(--lime-dark)"
                      : "border-(color:--line) bg-(--paper) hover:border-(color:--ash-950) hover:bg-(--ash-50)"
                  }`}
                >
                  <span className="grid min-w-0 gap-0.5">
                    <span className="text-[17px] font-bold">{d.label}</span>
                    <span className={`truncate text-sm ${best ? "text-(color:--ash-800)" : "text-(color:--muted)"}`}>{d.desc}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className={`font-mono text-[13px] max-[420px]:hidden ${best ? "text-(color:--ash-800)" : "text-(color:--ash-600)"}`}>{d.href}</span>
                    <ArrowRight size={18} className="transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden="true" />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
