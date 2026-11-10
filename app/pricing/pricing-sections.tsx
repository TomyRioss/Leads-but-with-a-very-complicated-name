import { ArrowRight, Check, Download, History, MapPin, Plus, Sparkles, Table2 } from "lucide-react";

const callHref = `https://wa.me/5491134083140?text=${encodeURIComponent("Hola, quiero agendar una llamada para conocer los planes de Leadta.")}`;

function CallButton({ tone = "light" }: { tone?: "light" | "dark" }) {
  return (
    <a className={`price-button price-button-${tone}`} href={callHref} target="_blank" rel="noreferrer">
      Agendar llamada<ArrowRight size={16} aria-hidden="true" />
    </a>
  );
}

const examples = [
  { credits: "100", leads: "50", note: "Una prueba corta en una zona." },
  { credits: "500", leads: "250", note: "Varios rubros o barrios al mes." },
  { credits: "1.000", leads: "500", note: "Prospección constante de un equipo." },
];

const included = [
  { icon: MapPin, title: "Búsqueda en Google Maps", text: "Negocios por rubro y zona, listos para trabajar." },
  { icon: Table2, title: "Hoja de resultados", text: "Todos los leads en una tabla ordenada." },
  { icon: Sparkles, title: "Análisis de dolores", text: "Detectá qué le falta a cada negocio antes de contactarlo." },
  { icon: History, title: "Historial privado", text: "Tus búsquedas quedan guardadas y solo las ves vos." },
  { icon: Download, title: "Exportación CSV y XLSX", text: "Llevate la lista a tu CRM o a una planilla." },
  { icon: Check, title: "Soporte directo", text: "Hablás directo con nosotros." },
];

const steps = [
  { title: "Contanos tu volumen", text: "Cuántos leads querés buscar por mes y en qué rubros." },
  { title: "Armamos tu plan", text: "Lo ajustamos a ese volumen, sin costos de setup ni precio por usuario." },
  { title: "Empezás a buscar", text: "Con tus créditos cargados, buscás y exportás desde el primer día." },
];

const faqs = [
  { q: "¿Cuánto cuesta?", a: "Desde $15 USD/mes. El precio final se escala a tu volumen de búsquedas y lo definimos juntos en la llamada." },
  { q: "¿Hay costos de setup o precio por usuario?", a: "No. No cobramos setup ni por usuario: pagás por los leads que realmente buscás." },
  { q: "¿Cuántos leads rinde un plan?", a: "Cada lead consume 2 créditos. Con 500 créditos obtenés hasta 250 leads. El análisis de dolores suma 0,5 créditos por lead analizado." },
  { q: "¿Qué incluye todos los planes?", a: "Búsqueda de negocios de Google Maps por rubro y zona, hoja de resultados, análisis de dolores, historial privado, exportación CSV y XLSX, y soporte directo." },
  { q: "¿Cómo contrato?", a: "Agendá una llamada por WhatsApp, contanos tu volumen mensual y armamos el plan." },
];

export function PriceHero() {
  return (
    <section className="price-hero" aria-labelledby="price-title">
      <div className="price-inner">
        <p className="price-eyebrow">DESDE</p>
        <h1 id="price-title" className="price-amount">$15 USD/mes</h1>
        <p className="price-lede">escalado a tu volumen de búsquedas.</p>
        <div className="price-hero-row">
          <ul className="price-facts" aria-label="Condiciones">
            <li>Sin costos de setup</li>
            <li>Sin precio por usuario</li>
            <li>Plan a tu volumen mensual</li>
          </ul>
          <div className="price-hero-cta">
            <CallButton />
            <p>{"// Todos los planes incluyen búsqueda, análisis y exportación CSV. Soporte directo."}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

export function PriceSections() {
  return (
    <>
      <section className="price-band" aria-labelledby="price-credits">
        <div className="price-inner price-split">
          <div className="price-head">
            <p className="price-kicker">Créditos</p>
            <h2 id="price-credits">Cada lead cuesta 2 créditos.</h2>
            <p>Pagás por lo que buscás. El análisis de dolores de un lead suma 0,5 créditos más.</p>
          </div>
          <dl className="price-examples">
            {examples.map((item) => (
              <div key={item.credits}>
                <dt><strong>{item.credits}</strong> créditos</dt>
                <dd><span>hasta {item.leads} leads</span>{item.note}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="price-band price-band-paper" aria-labelledby="price-included">
        <div className="price-inner">
          <div className="price-head">
            <p className="price-kicker">Incluido</p>
            <h2 id="price-included">Todo lo que necesitás para prospectar.</h2>
          </div>
          <ul className="price-included">
            {included.map(({ icon: Icon, title, text }) => (
              <li key={title}>
                <Icon size={20} aria-hidden="true" />
                <h3>{title}</h3>
                <p>{text}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="price-band" aria-labelledby="price-steps">
        <div className="price-inner">
          <div className="price-head">
            <p className="price-kicker">Cómo se arma tu plan</p>
            <h2 id="price-steps">Tres pasos y estás buscando.</h2>
          </div>
          <ol className="price-steps">
            {steps.map((step, index) => (
              <li key={step.title}>
                <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="price-band price-band-paper" aria-labelledby="price-faq">
        <div className="price-inner price-split">
          <div className="price-head">
            <p className="price-kicker">Preguntas</p>
            <h2 id="price-faq">Lo que suelen preguntar.</h2>
          </div>
          <div className="price-faq">
            {faqs.map((item) => (
              <details key={item.q}>
                <summary>{item.q}<Plus size={18} aria-hidden="true" /></summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="price-final" aria-labelledby="price-final-title">
        <div className="price-inner price-final-row">
          <h2 id="price-final-title">Hablemos de tu volumen.</h2>
          <CallButton tone="dark" />
        </div>
      </section>
    </>
  );
}
