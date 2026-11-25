import type { ReactNode } from "react";
import { ArrowUp, CheckCheck, Globe, Mail, Phone } from "lucide-react";
import { SiWhatsapp } from "react-icons/si";
import { getTranslations } from "next-intl/server";

type Step = { title: string; text: string };
type Preview = { url: string; found: string; leads: string[]; contacts: string[]; message: string; sent: string };

const initials = (name: string) => name.split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase();

/** Miniatura de lo que pasa en cada paso: decorativa, el texto del paso dice lo mismo. */
function PreviewFrame({ children }: { children: ReactNode }) {
  return (
    <div aria-hidden="true" className="grid h-40 content-center rounded-2xl text-left border border-(color:--line) bg-(--paper) p-4 shadow-[0_18px_40px_-28px_color-mix(in_srgb,var(--ash-950)_45%,transparent)]">
      {children}
    </div>
  );
}

function InputPreview({ preview }: { preview: Preview }) {
  return (
    <PreviewFrame>
      <div className="flex items-center gap-2 rounded-xl border border-(color:--ink) bg-(--paper) py-1.5 pr-1.5 pl-3 shadow-[0_0_0_1px_var(--ink)]">
        <Globe size={15} className="shrink-0 text-(color:--ash-500)" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-(color:--ink)">{preview.url}</span>
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-(--lime) text-(color:--ash-950)"><ArrowUp size={15} /></span>
      </div>
    </PreviewFrame>
  );
}

function LeadsPreview({ preview }: { preview: Preview }) {
  return (
    <PreviewFrame>
      <p className="m-0 mb-2 text-xs font-semibold text-(color:--muted)">{preview.found}</p>
      <ul className="m-0 grid list-none gap-1.5 p-0">
        {preview.leads.map((name, index) => (
          <li key={name} className="flex items-center gap-2.5 rounded-lg bg-(--ash-50) px-2 py-1.5">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-(--ash-950) text-[10px] font-semibold text-(color:--lime)">{initials(name)}</span>
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-(color:--ink)">{name}</span>
            {preview.contacts[index] ? (
              <span className="inline-flex min-w-0 items-center gap-1 truncate text-[11px] text-(color:--ash-700) tabular-nums">
                {preview.contacts[index].includes("@") ? <Mail size={11} aria-hidden="true" className="shrink-0" /> : <Phone size={11} aria-hidden="true" className="shrink-0" />}
                {preview.contacts[index]}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </PreviewFrame>
  );
}

function MessagePreview({ preview }: { preview: Preview }) {
  return (
    <PreviewFrame>
      <div className="ml-auto max-w-[92%] rounded-2xl rounded-br-md bg-(--lime) px-3 py-2.5 text-[13px] leading-snug text-(color:--ash-950)">
        {preview.message}
        <span className="mt-1.5 flex items-center justify-end gap-1 text-[11px] font-semibold text-(color:--ash-800)">
          <SiWhatsapp size={11} />{preview.sent}<CheckCheck size={13} />
        </span>
      </div>
    </PreviewFrame>
  );
}

const PREVIEWS = [InputPreview, LeadsPreview, MessagePreview];

export async function HowItWorks() {
  const t = await getTranslations("Landing.how");
  const steps = t.raw("steps") as Step[];
  const preview = t.raw("preview") as Preview;
  return (
    <section className="lp-section lp-wrap" id="how" aria-labelledby="lp-how-title">
      <div className="lp-section-head">
        <h2 id="lp-how-title">{t.rich("title", { green: (chunks) => <span className="text-(color:--lime-dark)">{chunks}</span> })}</h2>
        <p className="lp-lead">{t("intro")}</p>
      </div>
      {/* Riel: vertical en mobile (línea a la izquierda de los nodos), horizontal desde md (línea entre los nodos). */}
      <ol className="relative m-0 grid list-none gap-10 p-0 md:grid-cols-3 md:gap-8">
        <span aria-hidden="true" className="absolute top-2 bottom-2 left-[17px] w-px bg-(--ash-300) md:top-[calc(10rem+2.375rem)] md:right-[16.6%] md:bottom-auto md:left-[16.6%] md:h-px md:w-auto" />
        {steps.map((step, index) => {
          const Preview = PREVIEWS[index];
          return (
            <li key={step.title} className="relative grid grid-cols-[36px_minmax(0,1fr)] gap-x-4 gap-y-4 md:grid-cols-1 md:content-start md:justify-items-center md:gap-y-5 md:text-center">
              <div className="col-start-2 w-full md:col-start-1">{Preview ? <Preview preview={preview} /> : null}</div>
              <span className="relative z-10 col-start-1 row-start-1 grid size-9 place-items-center self-start rounded-full bg-(--ash-950) text-sm font-semibold text-(color:--lime) tabular-nums ring-4 ring-(--ash-100) md:row-start-2" aria-hidden="true">{index + 1}</span>
              <div className="col-start-2 grid gap-1.5 md:col-start-1 md:max-w-[30ch]">
                <h3 className="m-0 text-lg leading-snug font-semibold tracking-[-0.02em] text-balance text-(color:--ink)">{step.title}</h3>
                <p className="m-0 text-[15px] leading-relaxed text-pretty text-(color:--ash-700)">{step.text}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
