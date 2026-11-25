import { CreditCard, Gift } from "lucide-react";
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
        <ul className="m-0 mt-6 flex list-none flex-wrap justify-center gap-2 p-0">
          {[Gift, CreditCard].map((Icon, i) => (
            <li key={i} className="inline-flex min-h-8 items-center gap-2 rounded-full bg-(--ash-150) px-3.5 text-[13px] font-medium text-(color:--ash-800)">
              <Icon size={14} aria-hidden="true" />
              {t(`badges.${i}`)}
            </li>
          ))}
        </ul>
        <ExploreInput />
      </div>
    </section>
  );
}
