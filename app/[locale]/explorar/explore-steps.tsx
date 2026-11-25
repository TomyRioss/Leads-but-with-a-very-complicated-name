"use client";

import { Fragment, useState, type ComponentType, type ReactNode } from "react";
import { preconnect } from "react-dom";
import { useTranslations } from "next-intl";
import {
  Briefcase, Building, Building2, Check, Gift, GraduationCap, Handshake, HeartPulse, Loader2, Lock, Mail, MapPin, MessagesSquare, Search,
  Send, ShoppingCart, Sparkles, Store, Utensils, Wrench, type LucideProps,
} from "lucide-react";
import { FaWhatsapp } from "react-icons/fa";
import { LeadsTable } from "./leads-table";
import { SiGmail, SiWhatsapp } from "react-icons/si";
import "@/app/[locale]/lead-suite/chat-panel.css";
import { FREE_LIMITS } from "@/lib/plans";
import { TRIAL_DAYS } from "@/lib/trial";
import {
  EXPLORE_LEAD_COUNT, type ExploreCampaign, type ExploreCompetitors, type ExploreLead, type ExploreProduct, type ExploreProposal,
} from "@/lib/explore/types";

const CARD = "rounded-xl border border-(color:--line) bg-(--paper) p-5 sm:p-7";
const LABEL = "text-[11px] font-semibold tracking-[0.08em] text-(color:--muted) uppercase";
const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(color:--ink)";

const CAMPAIGN_ICONS: Record<ExploreCampaign["icon"], ComponentType<LucideProps>> = {
  store: Store,
  utensils: Utensils,
  graduation: GraduationCap,
  "map-pin": MapPin,
  briefcase: Briefcase,
  "heart-pulse": HeartPulse,
  wrench: Wrench,
  building: Building,
  "shopping-cart": ShoppingCart,
  sparkles: Sparkles,
};

function cleanDomain(value: string) {
  return value.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/.*$/, "");
}

/** plain: sin borde, fondo ni padding (logo completo, p. ej. en la barra lateral). */
export function Favicon({ domain, size = 40, plain = false }: { domain: string; size?: number; plain?: boolean }) {
  preconnect("https://t1.gstatic.com");
  const [failed, setFailed] = useState(false);
  const host = cleanDomain(domain);
  if (!host || failed) {
    return (
      <span className="grid shrink-0 place-items-center rounded-lg bg-(--ash-150) text-(color:--ash-700)" style={{ width: size, height: size }} aria-hidden="true">
        <Building2 size={Math.round(size * 0.5)} />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- favicon externo chico; next/image exigiría allowlist del host.
    <img
      // Directo a gstatic: google.com/s2/favicons redirige acá y suma un salto (~0.4 s).
      src={`https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(`https://${host}`)}&size=64`}
      alt=""
      width={size}
      height={size}
      onError={() => setFailed(true)}
      className={plain ? "shrink-0 rounded-md object-contain" : "shrink-0 rounded-lg border border-(color:--line) bg-(--ash-50) object-contain p-1"}
    />
  );
}

/** Convierte **negritas** en <strong> sin HTML crudo. */
function RichPitch({ text }: { text: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return <>{parts.map((part, index) => (index % 2 ? <strong key={index} className="font-semibold text-(color:--ink)">{part}</strong> : <Fragment key={index}>{part}</Fragment>))}</>;
}

export function ResearchStep({ product, live = false }: { product: ExploreProduct; live?: boolean }) {
  const t = useTranslations("Explore");
  return (
    <section className={CARD} aria-labelledby="explore-product-name">
      <div className="flex flex-wrap items-center gap-4">
        <Favicon domain={product.domain} size={48} />
        <div className="min-w-0 flex-1">
          <h2 id="explore-product-name" className="truncate text-lg font-semibold tracking-tight">{product.name}</h2>
          {product.domain ? <p className="truncate text-sm text-(color:--muted)">{cleanDomain(product.domain)}</p> : null}
        </div>
        {live ? null : <span className="inline-flex items-center gap-1 rounded-full bg-(--lime) px-2.5 py-1 text-xs font-semibold text-(color:--ink)"><Check size={13} aria-hidden="true" />{t("found")}</span>}
      </div>
      <p className="mt-5 max-w-3xl text-[15px] leading-relaxed text-(color:--ash-800)">{product.summary}</p>
      {live && !product.location ? null : (
        <p className="mt-5 inline-flex items-center gap-1.5 rounded-full border border-(color:--line) bg-(--ash-50) px-3 py-1 text-xs text-(color:--ash-700)">
          <MapPin size={13} aria-hidden="true" />{t("location")}: {product.location || t("noLocation")}
        </p>
      )}
    </section>
  );
}

export function CompetitorsStep({ data }: { data: ExploreCompetitors }) {
  const t = useTranslations("Explore");
  return (
    <section className={`${CARD} space-y-8`} aria-label={t("titles.competitors")}>
      <div>
        <h2 className={LABEL}>{t("product")}</h2>
        <p className="mt-2 text-lg font-semibold tracking-tight">{data.headline}</p>
        <ul className="mt-3 space-y-2">
          {data.valueProps.map((item) => (
            <li key={item} className="flex items-start gap-2 text-sm text-(color:--ash-800)">
              <Check size={16} className="mt-0.5 shrink-0 text-(color:--lime-dark)" aria-hidden="true" />{item}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h2 className={LABEL}>{t("buyerSearches")}</h2>
        <ul className="mt-3 flex flex-wrap gap-2">
          {data.buyerSearches.map((item) => (
            <li key={item} className="inline-flex items-center gap-1.5 rounded-full border border-(color:--line) bg-(--ash-50) px-3 py-1.5 text-xs text-(color:--ash-800)">
              <Search size={13} className="text-(color:--muted)" aria-hidden="true" />{item}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <div className="flex items-center gap-2">
          <h2 className={LABEL}>{t("competitorsLabel")}</h2>
          <span className="rounded-full bg-(--ash-150) px-2 py-0.5 text-[11px] font-semibold text-(color:--ash-700)">{t("competitorsFound", { count: data.competitors.length })}</span>
        </div>
        <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {data.competitors.map((item) => (
            <li key={item.domain || item.name} className="flex min-w-0 items-center gap-3 rounded-lg border border-(color:--line) bg-(--ash-50) p-3">
              <Favicon domain={item.domain} size={32} />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{item.name}</p>
                {item.domain ? <p className="truncate text-xs text-(color:--muted)">{cleanDomain(item.domain)}</p> : null}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** extra: contenido no interactivo al pie de cada tarjeta (p. ej. cantidad de leads en /campanas). */
export function CampaignsStep({ campaigns, selectedId, onSelect, extra }: { campaigns: ExploreCampaign[]; selectedId: string; onSelect: (id: string) => void; extra?: (campaign: ExploreCampaign) => ReactNode }) {
  const t = useTranslations("Explore");
  return (
    <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {campaigns.map((campaign) => {
        const Icon = CAMPAIGN_ICONS[campaign.icon] ?? Sparkles;
        const selected = campaign.id === selectedId;
        const fit = Math.max(0, Math.min(100, Math.round(campaign.fit)));
        return (
          <li key={campaign.id}>
            <button
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect(campaign.id)}
              className={`flex h-full w-full flex-col rounded-xl bg-(--paper) p-5 text-left transition-colors ${FOCUS} ${selected ? "border-2 border-(color:--ink)" : "border-2 border-(color:--line) hover:border-(color:--ash-400)"}`}
            >
              <span className="flex items-center gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-(--ash-150) text-(color:--ink)" aria-hidden="true"><Icon size={19} /></span>
                <span className="min-w-0 flex-1 truncate text-base font-semibold">{campaign.name}</span>
                {selected ? <span className="rounded-full bg-(--lime) px-2 py-0.5 text-[11px] font-semibold">{t("selected")}</span> : null}
              </span>
              <span className="mt-5 flex items-baseline gap-2">
                <span className="text-3xl font-semibold tracking-tight tabular-nums">{fit}%</span>
                <span className="text-xs text-(color:--muted)">{t("fitLabel")}</span>
              </span>
              <span className="mt-2 block h-1.5 w-full overflow-hidden rounded-full bg-(--ash-150)" aria-hidden="true">
                <span className="block h-full rounded-full bg-(--lime-dark)" style={{ width: `${fit}%` }} />
              </span>
              <span className="mt-4 block text-sm leading-relaxed text-(color:--ash-700)"><RichPitch text={campaign.pitch} /></span>
              <span className="mt-4 block rounded-lg bg-(--ash-50) p-3">
                <span className={`${LABEL} block`}>{t("pain")}</span>
                <span className="mt-1 block text-sm text-(color:--ash-800)">{campaign.pain}</span>
              </span>
              <span className={`${LABEL} mt-4 block`}>{t("criteria")}</span>
              <span className="mt-2 block space-y-1.5">
                {campaign.criteria.map((item) => (
                  <span key={item} className="flex items-start gap-2 text-sm text-(color:--ash-800)">
                    <Check size={15} className="mt-0.5 shrink-0 text-(color:--lime-dark)" aria-hidden="true" />{item}
                  </span>
                ))}
              </span>
              {campaign.examples.length ? (
                <span className="mt-4 flex flex-wrap gap-1.5">
                  {campaign.examples.map((item) => (
                    <span key={item} className="rounded-full border border-(color:--line) px-2.5 py-1 text-xs text-(color:--ash-700)">{item}</span>
                  ))}
                </span>
              ) : null}
              {extra ? extra(campaign) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function LeadsStep({ leads, campaign, loading }: { leads: ExploreLead[] | null; campaign: ExploreCampaign | null; loading: boolean }) {
  const t = useTranslations("Explore");
  const count = leads?.length ?? EXPLORE_LEAD_COUNT;
  const name = campaign?.name ?? "";
  return (
    <section aria-labelledby="explore-leads-title">
      <h2 id="explore-leads-title" className="mb-3 text-sm font-semibold text-(color:--ash-800)">
        {loading ? t("searchLeads", { count: EXPLORE_LEAD_COUNT, campaign: name }) : t("leadsHeader", { count, campaign: name })}
      </h2>
      {loading ? (
        <p role="status" className="mb-3 flex items-center gap-2 text-sm text-(color:--muted)">
          <Loader2 size={16} className="animate-spin text-(color:--ink) motion-reduce:animate-none" aria-hidden="true" />{t("working.leads")}
        </p>
      ) : null}
      <LeadsTable leads={leads} loading={loading} />
    </section>
  );
}

const NEXT_STEPS = [
  { key: "send", Icon: Send },
  { key: "replies", Icon: MessagesSquare },
  { key: "close", Icon: Handshake },
] as const;

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("") || "?";
}

export function ProposalsStep({ proposals, leads, onSend }: { proposals: ExploreProposal[]; leads: ExploreLead[]; onSend: () => void }) {
  const t = useTranslations("Explore");
  const [activeId, setActiveId] = useState(proposals[0]?.leadId ?? "");
  const [edits, setEdits] = useState<Record<string, string>>({});
  if (!proposals.length) return <p className={`${CARD} text-sm text-(color:--muted)`}>{t("noProposals")}</p>;

  const names = new Map(leads.map((lead) => [lead.id, lead.name]));
  const whatsapp = proposals.filter((item) => item.channel === "whatsapp").length;
  const active = proposals.find((item) => item.leadId === activeId) ?? proposals[0];
  const activeName = names.get(active.leadId) ?? active.to;
  const body = edits[active.leadId] ?? active.body;

  return (
    <section aria-label={t("titles.proposals")}>
      <ul className="mb-4 flex flex-wrap gap-2 text-xs">
        <li className="inline-flex items-center gap-1.5 rounded-full border border-(color:--line) bg-(--paper) px-3 py-1.5 font-medium">
          <FaWhatsapp aria-hidden="true" className="text-(color:--ash-700)" /><Mail size={13} aria-hidden="true" className="text-(color:--ash-700)" />
          {t("proposalsSummary", { whatsapp, gmail: proposals.length - whatsapp })}
        </li>
      </ul>
      <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex flex-col gap-4 rounded-xl border border-(color:--line) bg-(--paper) p-5 sm:flex-row sm:items-center">
          <Gift size={26} aria-hidden="true" className="shrink-0 text-(color:--lime-dark)" />
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold tracking-tight">{t("trialOffer.title", { days: TRIAL_DAYS })}</p>
            <ul className="mt-2 flex flex-wrap gap-1.5 text-xs text-(color:--ash-700)">
              {[t("trialOffer.plan"), t("trialOffer.whatsapp", { count: FREE_LIMITS.whatsappMonthly }), t("trialOffer.after")].map((item) => (
                <li key={item} className="rounded-md bg-(--ash-100) px-2 py-1">{item}</li>
              ))}
            </ul>
          </div>
          <button type="button" onClick={onSend} className={`inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-(--lime) px-5 text-sm font-semibold text-(color:--ink) hover:bg-(--lime-dark) ${FOCUS}`}>
            {t("trialOffer.cta")}
          </button>
        </div>
        <div className="rounded-xl border border-(color:--line) bg-(--paper) p-5">
          <p className={LABEL}>{t("trialOffer.next")}</p>
          <ol className="mt-3 flex flex-wrap gap-x-4 gap-y-3">
            {NEXT_STEPS.map(({ key, Icon }) => (
              <li key={key} className="flex items-center gap-2.5 text-sm leading-tight font-medium">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-(--ash-100) text-(color:--ink)" aria-hidden="true"><Icon size={16} /></span>
                <span className="lg:max-w-[5.5rem]">{t(`trialOffer.steps.${key}`)}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <div className="grid overflow-hidden rounded-xl border border-(color:--line) bg-(--paper) md:grid-cols-[300px_minmax(0,1fr)]">
        <ul aria-label={t("proposalsListAria")} className="max-h-[560px] overflow-y-auto border-b border-(color:--line) md:border-r md:border-b-0">
          {proposals.map((item) => {
            const name = names.get(item.leadId) ?? item.to;
            const current = item.leadId === active.leadId;
            return (
              <li key={item.leadId} className="border-b border-(color:--ash-150) last:border-b-0">
                <button
                  type="button"
                  aria-current={current ? "true" : undefined}
                  onClick={() => setActiveId(item.leadId)}
                  className={`flex w-full items-start gap-3 px-4 py-3 text-left -outline-offset-2 focus-visible:outline-2 focus-visible:outline-(color:--ink) ${current ? "bg-(--ash-100)" : "hover:bg-(--ash-50)"}`}
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-(--ash-150) text-xs font-semibold text-(color:--ash-800)" aria-hidden="true">{initials(name)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{name}</span>
                    <span className="mt-0.5 block truncate text-xs text-(color:--muted)">
                      <span className="sr-only">{t(`channel.${item.channel}`)}:</span>{item.to}
                    </span>
                  </span>
                  {item.channel === "whatsapp"
                    ? <SiWhatsapp size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-[#25D366]" />
                    : <SiGmail size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-[#EA4335]" />}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="flex min-w-0 flex-col p-5 sm:p-6">
          <h2 className="text-base font-semibold tracking-tight">{activeName}</h2>
          <dl className="mt-4 space-y-2 border-b border-(color:--line) pb-4 text-sm">
            <div className="flex gap-3">
              <dt className="w-16 shrink-0 text-(color:--muted)">{t("to")}</dt>
              <dd className="flex min-w-0 items-center gap-1.5 truncate">
                {active.channel === "whatsapp" ? <FaWhatsapp aria-hidden="true" className="shrink-0 text-(color:--ash-700)" /> : <Mail size={14} aria-hidden="true" className="shrink-0 text-(color:--ash-700)" />}
                <span className="sr-only">{t(`channel.${active.channel}`)}:</span>{active.to}
              </dd>
            </div>
            {active.channel === "gmail" ? (
              <div className="flex gap-3">
                <dt className="w-16 shrink-0 text-(color:--muted)">{t("subject")}</dt>
                <dd className="min-w-0 font-medium">{active.subject}</dd>
              </div>
            ) : null}
          </dl>
          <label htmlFor="explore-proposal-body" className="sr-only">{t("body")}</label>
          <textarea
            id="explore-proposal-body"
            value={body}
            onChange={(event) => setEdits((prev) => ({ ...prev, [active.leadId]: event.target.value }))}
            rows={12}
            className="mt-4 min-h-64 w-full flex-1 resize-y rounded-lg border border-(color:--line) bg-(--ash-50) p-4 text-sm leading-relaxed whitespace-pre-wrap text-(color:--ash-900) focus-visible:outline-2 focus-visible:outline-(color:--ink)"
          />
          <div className="mt-4 flex justify-end">
            <button type="button" onClick={onSend} className={`inline-flex min-h-11 items-center gap-2 rounded-lg bg-(--lime) px-5 text-sm font-semibold text-(color:--ink) hover:bg-(--lime-dark) ${FOCUS}`}>
              <Lock size={15} aria-hidden="true" />{t("send")}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
