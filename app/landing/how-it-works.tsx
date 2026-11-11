import { FileSpreadsheet, Layers, Search } from "lucide-react";
import { getTranslations } from "next-intl/server";

const stepIcons = [Search, Layers, FileSpreadsheet];

export async function HowItWorks() {
  const t = await getTranslations("Landing.how");
  const steps = t.raw("steps") as { title: string; text: string }[];
  return (
    <section className="lp-section lp-wrap" id="how" aria-labelledby="lp-how-title">
      <div className="lp-section-head">
        <h2 id="lp-how-title">{t("title")}</h2>
        <p className="lp-lead">{t("intro")}</p>
      </div>
      <ol className="lp-steps">
        {steps.map((step, index) => {
          const Icon = stepIcons[index];
          return (
            <li key={step.title}>
              <div className="lp-step-top">
                <span className="lp-step-num" aria-hidden="true">{index + 1}</span>
                <Icon size={22} strokeWidth={1.75} aria-hidden="true" />
              </div>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
