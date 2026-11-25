import { getTranslations } from "next-intl/server";

const underline = "underline decoration-(--lime) underline-offset-[0.12em] [text-decoration-skip-ink:none]";

export async function Hero() {
  const t = await getTranslations("Landing.hero");
  return (
    <section className="lp-hero lp-wrap" aria-labelledby="lp-hero-title">
      <div className="lp-hero-copy mb-0!">
        <h1 id="lp-hero-title">
          {t.rich("title", {
            strong: (chunks) => <span className={`${underline} decoration-[0.1em]`}>{chunks}</span>,
            u: (chunks) => <span className={`${underline} decoration-[0.05em]`}>{chunks}</span>,
          })}
        </h1>
      </div>
    </section>
  );
}
