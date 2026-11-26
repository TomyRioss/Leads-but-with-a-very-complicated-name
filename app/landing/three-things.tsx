import { getTranslations } from "next-intl/server";
import { SiGmail, SiWhatsapp } from "react-icons/si";

type Item = { title: string; text: string };

// Inclinación de cada tarjeta, como notas apoyadas sobre la mesa; al pasar el mouse se enderezan.
const TILTS = ["-rotate-[1.5deg]", "rotate-[0.6deg]", "-rotate-[0.4deg]"];

// Solo la tarjeta de canales (índice 2) lleva los logos de WhatsApp y Gmail, abajo a la derecha.
const CHANNELS_INDEX = 2;

export async function ThreeThings() {
  const t = await getTranslations("Landing.edge");
  const items = t.raw("items") as Item[];
  return (
    <section className="lp-section" id="edge" aria-labelledby="lp-edge-title">
      <div className="lp-wrap grid items-center gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-16">
        <h2 id="lp-edge-title" className="text-left font-medium! text-[clamp(2rem,1.3rem+2.6vw,3.5rem)]! leading-[1.05]!">
          {t.rich("title", { mark: (chunks) => <mark className="whitespace-nowrap decoration-[0.16em]!">{chunks}</mark> })}
        </h2>
        <ul className="m-0 grid list-none gap-5 p-0">
          {items.map((item, index) => (
            <li
              key={item.title}
              className={`relative flex min-h-[150px] flex-col justify-center gap-3 rounded-[22px] bg-white px-7 py-7 shadow-[0_1px_2px_color-mix(in_srgb,var(--ash-950)_6%,transparent),0_18px_40px_-24px_color-mix(in_srgb,var(--ash-950)_35%,transparent)] transition-[rotate,translate,box-shadow] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-1 hover:rotate-0 motion-reduce:transition-none ${TILTS[index % TILTS.length]}`}
            >
              <h3 className="m-0 text-[clamp(1.75rem,1.2rem+1.4vw,2.35rem)]! leading-[1.1]! font-medium! tracking-[-0.03em]! text-(color:--ink)">{item.title}</h3>
              {/* pr-17 reserva el ancho de los logos (absolutos) para que el texto no pase por debajo. */}
              <p className={`m-0 max-w-[48ch] text-[15px] leading-normal text-(color:--muted) ${index === CHANNELS_INDEX ? "pr-17" : ""}`}>{item.text}</p>
              {index === CHANNELS_INDEX ? (
                <span className="absolute right-7 bottom-6 flex items-center gap-2" aria-hidden="true">
                  <SiWhatsapp size={26} className="text-[#25D366]" />
                  <SiGmail size={26} className="text-[#EA4335]" />
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
