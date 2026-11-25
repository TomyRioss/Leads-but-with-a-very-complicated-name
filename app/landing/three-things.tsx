import { getTranslations } from "next-intl/server";

type Item = { title: string; text: string };

// Inclinación de cada tarjeta, como notas apoyadas sobre la mesa; al pasar el mouse se enderezan.
const TILTS = ["-rotate-[1.5deg]", "rotate-[0.6deg]", "-rotate-[0.4deg]"];

export async function ThreeThings() {
  const t = await getTranslations("Landing.edge");
  const items = t.raw("items") as Item[];
  return (
    <section className="lp-section" id="edge" aria-labelledby="lp-edge-title">
      <div className="lp-wrap">
        <div className="lp-section-head">
          <h2 id="lp-edge-title" className="font-medium!">{t("title")}</h2>
        </div>
        <ul className="m-0 grid list-none gap-5 p-0 md:grid-cols-3 md:gap-6">
          {items.map((item, index) => (
            <li
              key={item.title}
              className={`flex min-h-[176px] flex-col justify-between gap-8 rounded-[22px] bg-white px-7 pt-7 pb-6 shadow-[0_1px_2px_color-mix(in_srgb,var(--ash-950)_6%,transparent),0_18px_40px_-24px_color-mix(in_srgb,var(--ash-950)_35%,transparent)] transition-[rotate,translate,box-shadow] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-1 hover:rotate-0 motion-reduce:transition-none md:min-h-[244px] ${TILTS[index % TILTS.length]}`}
            >
              <h3 className="m-0 text-[clamp(1.75rem,1.2rem+1.4vw,2.35rem)]! leading-[1.1]! font-medium! tracking-[-0.03em]! text-(color:--ink)">{item.title}</h3>
              <p className="m-0 max-w-[32ch] text-[15px] leading-normal text-(color:--muted)">{item.text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
