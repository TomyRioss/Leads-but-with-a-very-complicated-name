import { BadgeCheck, MessageSquareQuote } from "lucide-react";
import { getTranslations } from "next-intl/server";

type Review = { stars: string; quote: string; pain: string };

export async function PainsEnrichment() {
  const t = await getTranslations("Landing.pains");
  const reviews = t.raw("reviews") as Review[];
  const networks = t.raw("networks") as string[];
  return (
    <section className="lp-dark" id="pains" aria-labelledby="lp-pains-title">
      <div className="lp-wrap lp-dark-inner">
        <div className="lp-split lp-split-wide">
          <div className="lp-split-copy">
            <h2 id="lp-pains-title">{t("title")}</h2>
            <p className="lp-lead">{t("text")}</p>
            <p className="lp-honest">{t("honest")}</p>
            <p className="lp-credit-note">{t("credit")}</p>
          </div>
          <ul className="lp-reviews" aria-label={t("reviewsLabel")}>
            {reviews.map((review) => (
              <li key={review.quote}>
                <blockquote>
                  <MessageSquareQuote size={18} aria-hidden="true" />
                  <p>{review.quote}</p>
                  <footer>{review.stars}</footer>
                </blockquote>
                <p className="lp-finding"><span>{t("findingLabel")}</span> <strong>{review.pain}</strong></p>
              </li>
            ))}
          </ul>
        </div>
        <div className="lp-enrich">
          <div>
            <h3>{t("enrichTitle")}</h3>
            <p>{t("enrichText")}</p>
          </div>
          <ul className="lp-networks">
            {networks.map((network) => (
              <li key={network}><BadgeCheck size={16} aria-hidden="true" />{network}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
