"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Building2, Mail, Phone } from "lucide-react";
import { FaWhatsapp } from "react-icons/fa";
import type { ExploreLead } from "@/lib/explore/types";

const host = (value: string) => value.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/[/?#].*$/, "");
const href = (value: string) => (/^https?:\/\//i.test(value) ? value : `https://${value}`);

// ponytail: "!" porque globals.css define th/td sin @layer y pisa las utilidades.
const TH = "sticky top-0 z-10 h-auto! border-r-0! border-b border-(color:--line) bg-(--paper)! px-4! py-3.5! text-left text-[11px]! font-semibold tracking-[0.06em] text-(color:--muted)! uppercase";
const TD = "h-auto! max-w-none! border-r-0! border-b border-(color:--ash-150) px-4! py-5! align-middle whitespace-normal!";

function LeadIcon({ website }: { website: string }) {
  const [failed, setFailed] = useState(false);
  const domain = host(website);
  if (!domain || failed) {
    return <span className="grid size-5 shrink-0 place-items-center rounded bg-(--ash-150) text-(color:--ash-600)" aria-hidden="true"><Building2 size={12} /></span>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- favicon externo de 32px
    <img
      src={`https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(`https://${domain}`)}&size=32`}
      alt=""
      width={20}
      height={20}
      loading="lazy"
      onError={() => setFailed(true)}
      className="size-5 shrink-0 rounded object-contain"
    />
  );
}

/** Tabla de clientes potenciales del paso 4 de /explorar. */
export function LeadsTable({ leads, loading }: { leads: ExploreLead[] | null; loading: boolean }) {
  const t = useTranslations("Explore");
  const missing = <span className="text-(color:--ash-500)">{t("noData")}</span>;
  const columns = [t("columns.business"), t("columns.category"), t("columns.contact")];

  return (
    <div className="max-h-[calc(100dvh-7rem)] overflow-auto rounded-xl border border-(color:--line) bg-(--paper)" tabIndex={0} aria-label={t("leadsTableAria")}>
      <table className="w-full! min-w-[640px]! border-collapse text-[13px]">
        <thead>
          <tr>{columns.map((label) => <th key={label} scope="col" className={TH}>{label}</th>)}</tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: 8 }, (_, index) => (
              <tr key={`skeleton-${index}`} aria-hidden="true">
                {columns.map((label) => (
                  <td key={label} className={TD}><span className="block h-3.5 w-3/4 animate-pulse rounded bg-(--ash-150) motion-reduce:animate-none" /></td>
                ))}
              </tr>
            ))
            : leads?.length
              ? leads.map((lead) => (
                <tr key={lead.id} className="transition-colors hover:bg-(--ash-50)">
                  <td className={`${TD} w-[40%]`}>
                    <div className="flex min-w-0 items-center gap-2.5">
                      <LeadIcon website={lead.website} />
                      <div className="min-w-0">
                        {lead.maps_url
                          ? <a href={lead.maps_url} target="_blank" rel="noopener noreferrer" title={lead.name} className="block truncate font-semibold text-(color:--ink) hover:underline">{lead.name}</a>
                          : <strong title={lead.name} className="block truncate font-semibold">{lead.name}</strong>}
                        {lead.website
                          ? <a href={href(lead.website)} target="_blank" rel="noopener noreferrer" className="block truncate text-xs text-(color:--muted) hover:text-(color:--ink)">{host(lead.website)}</a>
                          : <span className="block text-xs text-(color:--ash-500)">{t("noData")}</span>}
                      </div>
                    </div>
                  </td>
                  <td className={`${TD} w-[30%] text-(color:--ash-800)`}><span className="line-clamp-2">{lead.category || missing}</span></td>
                  <td className={`${TD} w-[30%]`}>
                    <div className="flex min-w-0 flex-col gap-0.5">
                      {lead.whatsapp
                        ? <span className="flex items-center gap-1.5 text-(color:--whatsapp) tabular-nums"><FaWhatsapp aria-hidden="true" />{lead.whatsapp}</span>
                        : lead.phone ? <span className="flex items-center gap-1.5 tabular-nums"><Phone size={12} aria-hidden="true" />{lead.phone}</span> : null}
                      {lead.email
                        ? <a href={`mailto:${lead.email}`} title={lead.email} className="flex min-w-0 items-center gap-1.5 text-(color:--ash-800) hover:underline"><Mail size={12} className="shrink-0" aria-hidden="true" /><span className="truncate">{lead.email}</span></a>
                        : null}
                      {!lead.whatsapp && !lead.phone && !lead.email ? missing : null}
                    </div>
                  </td>
                </tr>
              ))
              : <tr><td colSpan={columns.length} className="px-4 py-8 text-center font-semibold text-(color:--ash-800)">{t("noLeads")}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
