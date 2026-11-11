import { Plus } from "lucide-react";
import { getTranslations } from "next-intl/server";

export async function Faq() {
  const t = await getTranslations("Landing.faq");
  const items = t.raw("items") as { q: string; a: string }[];
  return (
    <section className="lp-section lp-wrap lp-split lp-faq" id="faq" aria-labelledby="lp-faq-title">
      <div className="lp-split-copy">
        <h2 id="lp-faq-title">{t("title")}</h2>
      </div>
      <div className="lp-faq-list">
        {items.map((item) => (
          <details key={item.q}>
            <summary>
              <span>{item.q}</span>
              <Plus size={20} aria-hidden="true" />
            </summary>
            <p>{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
