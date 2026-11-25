import { ArrowRight, FileSpreadsheet, Layers, Search } from "lucide-react";
import { getTranslations } from "next-intl/server";

const stepIcons = [Search, Layers, FileSpreadsheet];

export async function HowItWorks() {
  const t = await getTranslations("Landing.how");
  const steps = t.raw("steps") as { title: string }[];
  return (
    <section className="lp-section lp-wrap" id="how" aria-labelledby="lp-how-title">
      <div className="lp-section-head">
        <h2 id="lp-how-title">{t.rich("title", { green: (chunks) => <span className="text-(color:--lime-dark)">{chunks}</span> })}</h2>
        <p className="lp-lead">{t("intro")}</p>
      </div>
      <ol className="m-0 grid list-none gap-4 p-0 md:grid-cols-3 md:gap-6">
        {steps.map((step, index) => {
          const Icon = stepIcons[index];
          return (
            <li key={step.title} className="relative flex min-h-48 flex-col justify-between gap-8 rounded-2xl border border-(color:--line) bg-(--paper) p-6 sm:p-7">
              <div className="flex items-start justify-between">
                <span className="text-5xl leading-none font-medium tracking-[-0.04em] text-(color:--lime-dark) tabular-nums" aria-hidden="true">{index + 1}</span>
                <span className="grid size-11 place-items-center rounded-xl bg-(--ash-950) text-(color:--lime)" aria-hidden="true">
                  <Icon size={20} strokeWidth={1.9} />
                </span>
              </div>
              <h3 className="m-0 max-w-[24ch] text-lg leading-snug font-semibold tracking-[-0.02em] text-(color:--ink)">{step.title}</h3>
              {index < steps.length - 1 ? (
                <span className="absolute top-1/2 -right-[19px] z-10 hidden size-8 -translate-y-1/2 place-items-center rounded-full border border-(color:--line) bg-(--ash-100) text-(color:--ash-700) md:grid" aria-hidden="true">
                  <ArrowRight size={15} />
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
