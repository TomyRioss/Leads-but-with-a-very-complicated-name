import { getTranslations } from "next-intl/server";
import { ExploreInput } from "./explore-input";

export async function Hero() {
  const t = await getTranslations("Landing.hero");
  return (
    <section className="lp-hero lp-wrap" aria-labelledby="lp-hero-title">
      <div className="lp-hero-copy mb-0!">
        <h1 id="lp-hero-title" className="font-normal! tracking-[-0.065em]! leading-[0.95]!">
          {t.rich("title", {
            green: (chunks) => <span className="block mb-[0.14em] underline decoration-(--lime) decoration-[0.12em] underline-offset-[0.12em] [text-decoration-skip-ink:none]">{chunks}</span>,
            lime: (chunks) => <span className="text-(color:--lime-dark)">{chunks}</span>,
          })}
        </h1>
        <ExploreInput />
      </div>
    </section>
  );
}
