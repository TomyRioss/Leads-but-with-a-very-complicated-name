import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDown, ArrowRight, ArrowUpRight, Check, Download, History, MapPin, Search, Sparkles, Table2 } from "lucide-react";
import { BrandLogo } from "@/app/brand-logo";
import { PricingHero } from "@/app/pricing-hero";
import { LanguageSwitcher } from "@/app/language-switcher";
import { getTranslations, setRequestLocale } from "next-intl/server";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return locale === "en"
    ? { title: "Leadta | Find businesses to contact", description: "Find local businesses by industry and area. Review your leads in a spreadsheet and download each batch as CSV or XLSX." }
    : { title: "Leadta | Encontrá negocios para contactar", description: "Buscá negocios locales por rubro y zona. Revisá tus leads en una hoja y descargá cada lote en CSV o XLSX." };
}

const sampleLeads = [
  { name: "Comercio de ejemplo", category: "Veterinaria", reviews: "128 reseñas", rating: "4,6", email: "hola@ejemplo.com", whatsapp: "+54 11 5555-0101" },
  { name: "Negocio ilustrativo", category: "Clínica veterinaria", reviews: "64 reseñas", rating: "4,2", email: "Sin dato", whatsapp: "+54 11 5555-0142" },
  { name: "Local de muestra", category: "Veterinaria", reviews: "39 reseñas", rating: "4,8", email: "contacto@ejemplo.com", whatsapp: "Sin dato" },
];

async function SampleLeadSheet({ locale }: { locale: string }) {
  setRequestLocale(locale);
  const t = await getTranslations("Landing");
  const sampleNames = locale === "en" ? ["Sample business", "Example business", "Local business"] : sampleLeads.map((lead) => lead.name);
  const sampleCategories = locale === "en" ? ["Veterinary clinic", "Veterinary clinic", "Veterinary clinic"] : sampleLeads.map((lead) => lead.category);
  const reviewCounts = [128, 64, 39].map((count) => `${count} ${locale === "en" ? "reviews" : "reseñas"}`);
  const ratings = locale === "en" ? ["4.6", "4.2", "4.8"] : sampleLeads.map((lead) => lead.rating);
  const missing = locale === "en" ? "No data" : "Sin dato";
  return (
    <div className="landing-sheet-wrap" aria-label={t("sampleTitle")}>
      <div className="landing-sheet-toolbar">
        <div className="landing-window-dots" aria-hidden="true"><i /><i /><i /></div>
        <span>{t("sampleTitle")}</span>
        <span className="landing-sheet-date">{t("recentBatch")}</span>
      </div>
      <div className="landing-search-summary">
        <span className="landing-search-icon"><Search size={15} aria-hidden="true" /></span>
        <div><small>{t("search")}</small><strong>{locale === "en" ? "Veterinary clinics · Buenos Aires" : "Veterinarias · Buenos Aires"}</strong></div>
        <span className="landing-sheet-count">25 leads</span>
      </div>
      <div className="landing-sheet-scroll">
        <table className="landing-sheet-table">
          <thead><tr><th>{t("business")}</th><th>{t("email")}</th><th>{t("whatsapp")}</th></tr></thead>
          <tbody>{sampleLeads.map((lead, index) => <tr key={lead.name}>
            <td><strong>{sampleNames[index]}</strong><small>{sampleCategories[index]} · {reviewCounts[index]} · ★ {ratings[index]}</small></td>
            <td><span className={`landing-contact-value${lead.email === "Sin dato" ? " is-missing" : ""}`}>{lead.email === "Sin dato" ? missing : lead.email}</span></td>
            <td><span className={`landing-contact-value${lead.whatsapp === "Sin dato" ? " is-missing" : ""}`}>{lead.whatsapp === "Sin dato" ? missing : lead.whatsapp}</span></td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className="landing-sheet-footer"><span><i /> {t("illustrativeData")}</span><span>CSV <ArrowUpRight size={13} aria-hidden="true" /></span></div>
    </div>
  );
}

export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Landing");
  const steps = [
    { title: t("stepSearchTitle"), text: t("stepSearchText"), icon: Search },
    { title: t("stepBatchTitle"), text: t("stepBatchText"), icon: MapPin },
    { title: t("stepReviewTitle"), text: t("stepReviewText"), icon: Download },
  ];
  const benefits = [t("benefit1"), t("benefit2"), t("benefit3")];
  return (
    <main className="landing-page">
      <header className="landing-nav-wrap">
        <nav className="landing-nav" aria-label={locale === "en" ? "Main navigation" : "Navegación principal"}>
          <BrandLogo />
          <div className="landing-nav-links">
            <a href="#planes">{t("plans")}</a>
            <a href="#como-funciona">{t("howItWorks")}</a>
            <a href="#que-incluye">{t("included")}</a>
          </div>
          <div className="landing-nav-actions"><LanguageSwitcher /><Link className="landing-nav-cta" href="/buscar">{t("signIn")} <ArrowUpRight size={15} aria-hidden="true" /></Link></div>
        </nav>
      </header>

      <section className="landing-hero">
        <div className="landing-hero-inner">
          <div className="landing-hero-copy">
            <h1>{t("hero")} <em>{t("heroEmphasis")}</em></h1>
            <p className="landing-hero-description">{t("heroDescription")}</p>
            <div className="landing-hero-actions">
              <a className="landing-button-primary" href={`https://wa.me/5491134083140?text=${encodeURIComponent(locale === "en" ? "Hello, I'd like to schedule a Leadta demo." : "Hola, me gustaría agendar una demo de Leadta.")}`} target="_blank" rel="noreferrer">{t("demo")} <ArrowRight size={17} aria-hidden="true" /></a>
              <a className="landing-button-text" href="#como-funciona">{t("seeHow")} <ArrowDown size={15} aria-hidden="true" /></a>
            </div>
            <p className="landing-hero-footnote"><Check size={14} aria-hidden="true" /> {t("onePlace")}</p>
          </div>
          <div className="landing-hero-visual"><SampleLeadSheet locale={locale} /></div>
        </div>
        <div className="landing-hero-bottom" aria-hidden="true"><span>{t("fromSearch")}</span><i /><span>{t("toContact")}</span></div>
      </section>

      <section className="landing-intro" id="como-funciona">
        <div className="landing-section-heading">
          <p>{t("simple")}</p>
          <h2>{t("stepsTitle")}</h2>
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
            <div className="landing-mini-head"><Table2 size={16} /><span>{t("historyExample")}</span><b>{locale === "en" ? "3 batches" : "3 lotes"}</b></div>
            <div className="landing-mini-row is-selected"><span>{locale === "en" ? "Nov 6 · Batch 3" : "06 nov · Lote 3"}</span><strong>{locale === "en" ? "Veterinary clinics" : "Veterinarias"}</strong><i>25 leads</i></div>
            <div className="landing-mini-row"><span>{locale === "en" ? "Nov 4 · Batch 2" : "04 nov · Lote 2"}</span><strong>{locale === "en" ? "Accounting firms" : "Estudios contables"}</strong><i>50 leads</i></div>
            <div className="landing-mini-row"><span>{locale === "en" ? "Nov 1 · Batch 1" : "01 nov · Lote 1"}</span><strong>{locale === "en" ? "Real estate agencies" : "Inmobiliarias"}</strong><i>25 leads</i></div>
            <div className="landing-mini-download"><Download size={14} /> {t("downloadBatch")} <span>CSV · XLSX</span></div>
          </div>
          <div className="landing-history-stamp"><History size={16} /><span>{t("savedHistory")}</span></div>
        </div>
        <div className="landing-workspace-copy">
          <p>{t("workspaceTitle")}</p>
          <h2>{t("workspaceHeading")}</h2>
          <p className="landing-workspace-description">{t("workspaceDescription")}</p>
          <ul>{benefits.map((benefit) => <li key={benefit}><Check size={15} aria-hidden="true" /> <span>{benefit}</span></li>)}</ul>
          <Link className="landing-inline-link" href="/buscar?signup=1">{t("explore")} <ArrowUpRight size={15} aria-hidden="true" /></Link>
        </div>
      </section>

      <PricingHero variant="landing" id="planes" locale={locale} />

      <section className="landing-final-cta">
        <div className="landing-final-copy"><Sparkles size={18} aria-hidden="true" /><p>{t("finalTitle")}</p></div>
        <Link className="landing-button-primary" href="/buscar?signup=1">{t("finalButton")} <ArrowRight size={17} aria-hidden="true" /></Link>
      </section>

      <footer className="landing-footer">
        <BrandLogo />
        <span>{t("brandPromise")}</span>
        <Link href="/pricing">{t("plans")} <ArrowUpRight size={13} aria-hidden="true" /></Link>
      </footer>
    </main>
  );
}
