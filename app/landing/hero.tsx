import { getTranslations } from "next-intl/server";

export async function Hero() {
  const t = await getTranslations("Landing.hero");
  return (
    <section className="lp-hero lp-wrap" aria-labelledby="lp-hero-title">
      <div className="lp-hero-copy mb-0!">
        <h1 id="lp-hero-title">
          {t.rich("title", {
            green: (chunks) => <span className="text-(color:--lime-dark)">{chunks}</span>,
          })}
        </h1>
      </div>
    </section>
  );
}
