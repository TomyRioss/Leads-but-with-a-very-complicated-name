import { getTranslations } from "next-intl/server";
import { ExploreInput } from "./explore-input";

export async function Hero() {
  const t = await getTranslations("Landing.hero");
  return (
    <section className="lp-hero lp-wrap" aria-labelledby="lp-hero-title">
      <div className="lp-hero-copy mb-0!">
        <h1 id="lp-hero-title" className="tracking-[-0.065em]! leading-[0.95]!">
          {t.rich("title", {
            green: (chunks) => <span className="block text-(color:--lime-dark)">{chunks}</span>,
          })}
        </h1>
        <ExploreInput />
      </div>
    </section>
  );
}
