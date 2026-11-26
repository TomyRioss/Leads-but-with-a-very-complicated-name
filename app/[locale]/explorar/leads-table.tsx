"use client";

import { useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Building2, Mail, Phone } from "lucide-react";
import { FaWhatsapp } from "react-icons/fa";
import type { ExploreLead } from "@/lib/explore/types";

const host = (value: string) => value.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/[/?#].*$/, "");
const href = (value: string) => (/^https?:\/\//i.test(value) ? value : `https://${value}`);

// ponytail: "!" porque globals.css define th/td sin @layer y pisa las utilidades.
const TH = "sticky top-0 z-10 h-auto! border-r! border-(color:--ash-150)! last:border-r-0! border-b border-b-(color:--line)! bg-white! px-4! py-3.5! text-left text-[11px]! font-semibold tracking-[0.06em] text-(color:--muted)! uppercase";
// table-fixed toma los anchos de la primera fila (el encabezado).
const WIDTHS = ["w-[24%]", "w-[28%]", "w-[20%]", "w-[18%]", "w-[10%]"];
const TD = "h-auto! max-w-none! border-r! border-(color:--ash-150)! last:border-r-0! border-b px-4! py-6! align-middle whitespace-normal!";

function LeadIcon({ website }: { website: string }) {
  const [failed, setFailed] = useState(false);
  const domain = host(website);
  if (!domain || failed) {
    return <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-(--ash-150) text-(color:--ash-600)" aria-hidden="true"><Building2 size={16} /></span>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- favicon externo de 32px
    <img
      src={`https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(`https://${domain}`)}&size=64`}
      alt=""
      width={32}
      height={32}
      loading="lazy"
      onError={() => setFailed(true)}
      className="size-8 shrink-0 rounded-lg object-contain"
    />
  );
}

/** 1905 → "1.9K", 3000 → "3K", 454 → "454". */
export function compactCount(value: number) {
  if (!Number.isFinite(value) || value < 0) return "";
  if (value < 1000) return String(Math.round(value));
  return `${(Math.round(value / 100) / 10).toString()}K`;
}

/** Bandera + "País, Ciudad, Distrito"; corridas viejas sin esos campos muestran la dirección. */
function LeadLocation({ lead, locale, fallback }: { lead: ExploreLead; locale: string; fallback: ReactNode }) {
  const code = /^[A-Z]{2}$/.test(lead.country_code ?? "") ? lead.country_code! : "";
  let country = "";
  try {
    country = code ? new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? "" : "";
  } catch {
    country = "";
  }
  const parts = [...new Set([country, lead.city ?? "", lead.district ?? ""].flatMap((part) => part.split(",")).map((part) => part.trim()).filter(Boolean))];
  if (!parts.length) return lead.address ? <span className="line-clamp-2" title={lead.address}>{lead.address}</span> : <>{fallback}</>;
  return (
    <span className="flex min-w-0 items-center gap-2">
      {code ? (
        // eslint-disable-next-line @next/next/no-img-element -- bandera raster chica; el emoji de bandera no se ve en Windows.
        <img src={`https://flagcdn.com/w40/${code.toLowerCase()}.png`} alt="" width={20} height={14} loading="lazy" className="h-3.5 w-5 shrink-0 rounded-[3px] object-cover" />
      ) : null}
      <span className="line-clamp-2">{parts.join(", ")}</span>
    </span>
  );
}

/** Tabla de clientes potenciales del paso 4 de /explorar. */
export function LeadsTable({ leads, loading }: { leads: ExploreLead[] | null; loading: boolean }) {
  const t = useTranslations("Explore");
  const locale = useLocale();
  const missing = <span className="text-(color:--ash-500)">{t("noData")}</span>;
  const columns = [t("columns.business"), t("columns.description"), t("columns.location"), t("columns.contact"), t("columns.customers")];

  return (
    <div className="max-h-[calc(100dvh-6.5rem)] overflow-auto rounded-2xl [scrollbar-color:var(--ash-300)_transparent] [scrollbar-width:thin] border border-(color:--line) bg-white" tabIndex={0} aria-label={t("leadsTableAria")}>
      <table className="w-full! min-w-[900px]! table-fixed border-collapse text-[13px]">
        <thead>
          <tr>{columns.map((label, index) => <th key={label} scope="col" className={`${TH} ${WIDTHS[index]}`}>{label}</th>)}</tr>
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
                <tr key={lead.id} className="transition-colors hover:bg-(--ash-50)/60">
                  <td className={`${TD} w-[24%]`}>
                    <div className="flex min-w-0 items-center gap-3">
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
                  <td className={`${TD} w-[28%] text-(color:--ash-800)`}><span className="line-clamp-3" title={lead.description}>{lead.description || missing}</span></td>
                  <td className={`${TD} w-[20%] text-(color:--ash-800)`}><LeadLocation lead={lead} locale={locale} fallback={missing} /></td>
                  <td className={`${TD} w-[18%]`}>
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
                  <td className={`${TD} w-[10%] whitespace-nowrap! tabular-nums`}>
                    {lead.review_count ? <strong className="font-semibold">{compactCount(Number(lead.review_count))}</strong> : missing}
                  </td>
                </tr>
              ))
              : <tr><td colSpan={columns.length} className="px-4 py-8 text-center font-semibold text-(color:--ash-800)">{t("noLeads")}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
