import { ArrowRight } from "lucide-react";

const callHref = `https://wa.me/5491134083140?text=${encodeURIComponent("Hola, quiero agendar una llamada para conocer los planes de Leadta.")}`;

export function PricingHero({ variant, id }: { variant: "landing" | "page"; id?: string }) {
  const Title = variant === "page" ? "h1" : "h2";
  return (
    <section className={`pricing-hero pricing-hero-${variant}`} id={id} aria-labelledby="pricing-title">
      <div className="pricing-hero-inner">
        <p className="pricing-eyebrow">DESDE</p>
        <Title id="pricing-title" className="pricing-hero-price">$15 USD/mes</Title>
        <p className="pricing-hero-sub">escalado a tu volumen de búsquedas.</p>
        <div className="pricing-hero-rule" aria-hidden="true" />
        <div className="pricing-hero-foot">
          <p>Sin costos de setup. Sin precio por usuario. Pagás por los leads que realmente buscás — ajustamos el plan a tu volumen mensual.</p>
          <div className="pricing-hero-cta">
            <a className="pricing-hero-button" href={callHref} target="_blank" rel="noreferrer">Agendar llamada<ArrowRight size={16} aria-hidden="true" /></a>
            <p className="pricing-hero-note">{"// Todos los planes incluyen búsqueda, análisis y exportación CSV. Soporte directo."}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
