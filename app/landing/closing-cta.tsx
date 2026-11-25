import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { ClosingThreads } from "./closing-threads";

/** CTA de cierre: los hilos del hero nacen en el botón y se abren solo hacia abajo. */
export async function ClosingCta() {
  const t = await getTranslations("Landing.closing");
  return (
    <section className="relative isolate overflow-hidden pt-[clamp(72px,10vw,128px)]" aria-labelledby="lp-closing-title">
      <div className="lp-wrap relative z-10 grid justify-items-center gap-8 text-center">
        <h2 id="lp-closing-title" className="font-medium! text-[clamp(2.25rem,1.4rem+3.4vw,4.25rem)]! leading-[1.02]!">{t("title")}</h2>
        <Link
          href="/register"
          className="inline-flex min-h-12 items-center rounded-xl bg-(--ink) px-6 text-[15px] font-semibold text-(color:--paper) transition-colors hover:bg-(--ash-800) focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-(color:--ink)"
        >
          {t("button")}
        </Link>
      </div>
      {/* El borde superior del canvas queda en el centro del botón: ahí convergen los hilos. */}
      <div aria-hidden="true" className="pointer-events-none relative -mt-6 h-[clamp(260px,32vw,420px)] w-full [mask-image:linear-gradient(to_bottom,black_55%,transparent)]">
        <ClosingThreads />
      </div>
    </section>
  );
}
