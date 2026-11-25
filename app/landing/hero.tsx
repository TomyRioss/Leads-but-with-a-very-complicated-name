import { getTranslations } from "next-intl/server";

export async function Hero() {
  const t = await getTranslations("Landing.hero");
  return (
    <section className="lp-hero lp-wrap" aria-labelledby="lp-hero-title">
      <div className="lp-hero-copy mb-0!">
        <h1 id="lp-hero-title" className="text-[clamp(1.875rem,1.2rem+2.8vw,3.25rem)]! leading-none!">
          {t.rich("title", {
            green: (chunks) => <span className="block text-(color:--lime-dark)">{chunks}</span>,
          })}
        </h1>
      </div>
    </section>
  );
}
