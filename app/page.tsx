import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDown, ArrowRight, ArrowUpRight, Check, Download, History, MapPin, Search, Sparkles, Table2 } from "lucide-react";
import { BrandLogo } from "./brand-logo";
import { PricingHero } from "./pricing-hero";

export const metadata: Metadata = {
  title: "Leadta | Encontrá negocios para contactar",
  description: "Buscá negocios locales por rubro y zona. Revisá tus leads en una hoja y descargá cada lote en CSV o XLSX.",
};

const sampleLeads = [
  { name: "Comercio de ejemplo", category: "Veterinaria", reviews: "128 reseñas", rating: "4,6", email: "hola@ejemplo.com", whatsapp: "+54 11 5555-0101" },
  { name: "Negocio ilustrativo", category: "Clínica veterinaria", reviews: "64 reseñas", rating: "4,2", email: "Sin dato", whatsapp: "+54 11 5555-0142" },
  { name: "Local de muestra", category: "Veterinaria", reviews: "39 reseñas", rating: "4,8", email: "contacto@ejemplo.com", whatsapp: "Sin dato" },
];

const steps = [
  { title: "Elegí qué buscar", text: "Escribí un rubro o varias keywords, y seleccioná el país, la provincia y la ciudad.", icon: Search },
  { title: "Definí el tamaño del lote", text: "Elegí cuántos resultados querés recibir, hasta 150 negocios por búsqueda.", icon: MapPin },
  { title: "Revisá y descargá", text: "Explorá los datos en una hoja, filtrá lo que te sirve y exportá a CSV o XLSX.", icon: Download },
];

const benefits = [
  "Teléfono, web, mail y perfiles sociales cuando están disponibles.",
  "Lotes guardados en tu historial, ordenados para volver cuando quieras.",
  "Análisis opcional de reseñas y búsqueda de perfiles sociales públicos.",
];

function SampleLeadSheet() {
  return (
    <div className="landing-sheet-wrap" aria-label="Vista ilustrativa de la hoja de leads">
      <div className="landing-sheet-toolbar">
        <div className="landing-window-dots" aria-hidden="true"><i /><i /><i /></div>
        <span>Vista de ejemplo</span>
        <span className="landing-sheet-date">LOTE RECIENTE</span>
      </div>
      <div className="landing-search-summary">
        <span className="landing-search-icon"><Search size={15} aria-hidden="true" /></span>
        <div><small>BÚSQUEDA</small><strong>Veterinarias · Buenos Aires</strong></div>
        <span className="landing-sheet-count">25 leads</span>
      </div>
      <div className="landing-sheet-scroll">
        <table className="landing-sheet-table">
          <thead><tr><th>Negocio</th><th>Mail</th><th>WhatsApp</th></tr></thead>
          <tbody>{sampleLeads.map((lead) => <tr key={lead.name}>
            <td><strong>{lead.name}</strong><small>{lead.category} · {lead.reviews} · ★ {lead.rating}</small></td>
            <td><span className={`landing-contact-value${lead.email === "Sin dato" ? " is-missing" : ""}`}>{lead.email}</span></td>
            <td><span className={`landing-contact-value${lead.whatsapp === "Sin dato" ? " is-missing" : ""}`}>{lead.whatsapp}</span></td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className="landing-sheet-footer"><span><i /> Datos ilustrativos</span><span>CSV <ArrowUpRight size={13} aria-hidden="true" /></span></div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <main className="landing-page">
      <header className="landing-nav-wrap">
        <nav className="landing-nav" aria-label="Navegación principal">
          <BrandLogo />
          <div className="landing-nav-links">
            <a href="#planes">Planes</a>
            <a href="#como-funciona">Cómo funciona</a>
            <a href="#que-incluye">Qué incluye</a>
          </div>
          <Link className="landing-nav-cta" href="/buscar">Ingresar <ArrowUpRight size={15} aria-hidden="true" /></Link>
        </nav>
      </header>

      <section className="landing-hero">
        <div className="landing-hero-inner">
          <div className="landing-hero-copy">
            <h1>Encontrá negocios para <em>empezar la conversación.</em></h1>
            <p className="landing-hero-description">Elegí un rubro y una zona. Leadta organiza negocios de Google Maps en una hoja lista para revisar y descargar.</p>
            <div className="landing-hero-actions">
              <Link className="landing-button-primary" href="/buscar?signup=1">Crear mi lista <ArrowRight size={17} aria-hidden="true" /></Link>
              <a className="landing-button-text" href="#como-funciona">Ver cómo funciona <ArrowDown size={15} aria-hidden="true" /></a>
            </div>
            <p className="landing-hero-footnote"><Check size={14} aria-hidden="true" /> Búsqueda, hoja e historial en un solo lugar</p>
          </div>
          <div className="landing-hero-visual"><SampleLeadSheet /></div>
        </div>
        <div className="landing-hero-bottom" aria-hidden="true"><span>DE LA BÚSQUEDA</span><i /><span>A TU PRÓXIMO CONTACTO</span></div>
      </section>

      <section className="landing-intro" id="como-funciona">
        <div className="landing-section-heading">
          <p>Simple desde el primer paso</p>
          <h2>De una búsqueda a una lista lista para trabajar.</h2>
        </div>
        <div className="landing-steps">
          {steps.map(({ title, text, icon: Icon }, index) => <article className="landing-step" key={title}>
            <div className="landing-step-top"><span>{String(index + 1).padStart(2, "0")}</span><Icon size={19} strokeWidth={1.8} aria-hidden="true" /></div>
            <h3>{title}</h3><p>{text}</p>
          </article>)}
        </div>
      </section>

      <section className="landing-workspace" id="que-incluye">
        <div className="landing-workspace-art" aria-hidden="true">
          <div className="landing-mini-sheet">
            <div className="landing-mini-head"><Table2 size={16} /><span>HISTORIAL DE EJEMPLO</span><b>3 lotes</b></div>
            <div className="landing-mini-row is-selected"><span>06 nov · Lote 3</span><strong>Veterinarias</strong><i>25 leads</i></div>
            <div className="landing-mini-row"><span>04 nov · Lote 2</span><strong>Estudios contables</strong><i>50 leads</i></div>
            <div className="landing-mini-row"><span>01 nov · Lote 1</span><strong>Inmobiliarias</strong><i>25 leads</i></div>
            <div className="landing-mini-download"><Download size={14} /> Descargar lote <span>CSV · XLSX</span></div>
          </div>
          <div className="landing-history-stamp"><History size={16} /><span>Guardado<br />en tu historial</span></div>
        </div>
        <div className="landing-workspace-copy">
          <p>Una hoja que sigue tu ritmo</p>
          <h2>Tus negocios, en orden. Tus próximos pasos, más claros.</h2>
          <p className="landing-workspace-description">Cada búsqueda queda guardada como un lote. Volvé a la tabla unificada o abrí una búsqueda puntual y descargá sus datos cuando los necesites.</p>
          <ul>{benefits.map((benefit) => <li key={benefit}><Check size={15} aria-hidden="true" /> <span>{benefit}</span></li>)}</ul>
          <Link className="landing-inline-link" href="/buscar?signup=1">Explorar Leadta <ArrowUpRight size={15} aria-hidden="true" /></Link>
        </div>
      </section>

      <PricingHero variant="landing" id="planes" />

      <section className="landing-final-cta">
        <div className="landing-final-copy"><Sparkles size={18} aria-hidden="true" /><p>Tu próxima lista empieza con una búsqueda.</p></div>
        <Link className="landing-button-primary" href="/buscar?signup=1">Empezar ahora <ArrowRight size={17} aria-hidden="true" /></Link>
      </section>

      <footer className="landing-footer">
        <BrandLogo />
        <span>Encontrá. Organizá. Avanzá.</span>
        <Link href="/pricing">Créditos y planes <ArrowUpRight size={13} aria-hidden="true" /></Link>
      </footer>
    </main>
  );
}
