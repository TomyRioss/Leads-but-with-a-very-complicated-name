"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowRight, CircleCheck, Compass, Loader2, Megaphone, Search, Users } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import { CampaignsStep, LeadsStep } from "@/app/[locale]/explorar/explore-steps";
import { setSessionCredits } from "@/lib/client/session";
import type { ExploreLead } from "@/lib/explore/types";
import type { Lead } from "@/lib/types";
import type { Business, SalesCampaign } from "@/lib/workspace/types";
import {
  EmptyState, ErrorBanner, FilterChip, LoadingState, PageHeader, PRIMARY_BUTTON, SECONDARY_BUTTON, requestJson, useErrorMessage,
} from "@/app/workspace/workspace-ui";


function toExploreLead(lead: Lead): ExploreLead {
  return {
    id: lead.id,
    name: lead.name,
    category: lead.category,
    address: lead.address,
    phone: lead.phone,
    whatsapp: lead.whatsapp_status === "none" ? "" : lead.whatsapp || (lead.whatsapp_status === "verified" ? lead.phone : ""),
    email: lead.email,
    website: lead.website,
    maps_url: lead.maps_url,
    average_rating: lead.average_rating,
    review_count: lead.review_count,
  };
}

type LeadsState = { campaignId: string; leads: ExploreLead[] | null; error: string };

export function CampaignsView() {
  const t = useTranslations("Workspace.campaigns");
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const businessId = useSearchParams().get("business") ?? "";
  const [campaigns, setCampaigns] = useState<SalesCampaign[] | null>(null);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [leadsState, setLeadsState] = useState<LeadsState>({ campaignId: "", leads: null, error: "" });
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<{ message: string; credits: boolean } | null>(null);
  const [searchDone, setSearchDone] = useState<number | null>(null);
  const leadsRequest = useRef(0);

  const load = useCallback(async () => {
    setError("");
    setCampaigns(null);
    const query = businessId ? `?business=${encodeURIComponent(businessId)}` : "";
    // Independientes: en paralelo. Los negocios solo dan el nombre del filtro y de cada campaña.
    const [campaignsResult, businessesResult] = await Promise.all([
      requestJson<{ campaigns: SalesCampaign[] }>(`/api/sales-campaigns${query}`),
      requestJson<{ businesses: Business[] }>("/api/businesses"),
    ]);
    if (!campaignsResult.ok && campaignsResult.status === 401) return router.replace("/");
    if (businessesResult.ok) setBusinesses(businessesResult.data.businesses ?? []);
    if (!campaignsResult.ok) return setError(errorMessage(campaignsResult.error, campaignsResult.status, t("errLoad")));
    const list = campaignsResult.data.campaigns ?? [];
    setCampaigns(list);
    setSelectedId((current) => (list.some((item) => item.id === current) ? current : list[0]?.id ?? ""));
  }, [businessId, errorMessage, router, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const loadLeads = useCallback(async (campaignId: string) => {
    const requestId = ++leadsRequest.current;
    setLeadsState({ campaignId, leads: null, error: "" });
    const result = await requestJson<{ leads: Lead[] }>(`/api/sales-campaigns/${encodeURIComponent(campaignId)}/leads`);
    if (leadsRequest.current !== requestId) return;
    if (result.ok) setLeadsState({ campaignId, leads: (result.data.leads ?? []).map(toExploreLead), error: "" });
    else if (result.status === 401) router.replace("/");
    else setLeadsState({ campaignId, leads: null, error: errorMessage(result.error, result.status, t("errLeads")) });
  }, [errorMessage, router, t]);

  useEffect(() => {
    if (!selectedId) return;
    const timer = window.setTimeout(() => { void loadLeads(selectedId); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadLeads, selectedId]);

  function selectCampaign(id: string) {
    if (id === selectedId) return;
    setSelectedId(id);
    setSearchError(null);
    setSearchDone(null);
  }

  async function searchMore(campaign: SalesCampaign) {
    setSearching(true);
    setSearchError(null);
    setSearchDone(null);
    const result = await requestJson<{ batchId: string; created: number; credits: number }>(
      `/api/sales-campaigns/${encodeURIComponent(campaign.id)}/search`,
      { method: "POST", body: JSON.stringify({}) },
    );
    setSearching(false);
    if (!result.ok) {
      if (result.status === 401) return router.replace("/");
      return setSearchError({ message: errorMessage(result.error, result.status), credits: result.status === 402 || result.error === "insufficient_credits" });
    }
    const created = Number(result.data.created) || 0;
    if (typeof result.data.credits === "number") setSessionCredits(result.data.credits);
    setSearchDone(created);
    setCampaigns((current) => current?.map((item) => item.id === campaign.id
      ? { ...item, leadCount: item.leadCount + created, batchIds: result.data.batchId ? [...item.batchIds, result.data.batchId] : item.batchIds }
      : item) ?? current);
    if (created > 0) void loadLeads(campaign.id);
  }

  const businessNames = useMemo(() => new Map(businesses.map((item) => [item.id, item.name])), [businesses]);
  const selected = campaigns?.find((item) => item.id === selectedId) ?? null;
  const leads = leadsState.campaignId === selectedId ? leadsState.leads : null;
  const leadsError = leadsState.campaignId === selectedId ? leadsState.error : "";
  const filterName = businessId ? businessNames.get(businessId) ?? "…" : "";

  return (
    <section aria-labelledby="campaigns-title">
      <PageHeader id="campaigns-title" title={t("title")} intro={t("intro")} count={campaigns ? t("count", { count: campaigns.length }) : undefined}>
        {businessId ? <FilterChip label={t("filteredBy", { name: filterName })} clearHref="/campanas" /> : null}
      </PageHeader>
      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
      {!campaigns && !error ? <LoadingState label={t("loading")} /> : null}
      {campaigns && campaigns.length === 0 ? (
        businessId
          ? <EmptyState Icon={Megaphone} title={t("emptyFilteredTitle")} text={t("emptyFilteredText")} cta={{ href: "/campanas", label: t("title") }} />
          : <EmptyState Icon={Megaphone} title={t("emptyTitle")} text={t("emptyText")} cta={{ href: "/", label: t("emptyCta"), Icon: Compass }} />
      ) : null}

      {campaigns?.length ? (
        <>
          <CampaignsStep
            campaigns={campaigns}
            selectedId={selectedId}
            onSelect={selectCampaign}
            extra={(campaign) => {
              const item = campaign as SalesCampaign;
              const business = businessId ? "" : businessNames.get(item.businessId) ?? "";
              return (
                <span className="mt-auto block pt-4">
                  <span className="flex flex-wrap items-center gap-2 border-t border-(color:--ash-150) pt-3 text-xs text-(color:--ash-700)">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-(color:--ink)"><Users size={14} aria-hidden="true" />{t("leadCount", { count: item.leadCount })}</span>
                    {business ? <span className="min-w-0 truncate">· {business}</span> : null}
                  </span>
                </span>
              );
            }}
          />

          {selected ? (
            <section aria-labelledby="campaign-leads-title" className="mt-8">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 id="campaign-leads-title" className="text-lg font-semibold tracking-tight">{t("leadsTitle", { campaign: selected.name })}</h2>
                  {selected.keywords.length ? <p className="mt-0.5 text-xs text-(color:--muted)">{t("keywords", { keywords: selected.keywords.join(", ") })}</p> : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link href={`/propuestas?campaign=${encodeURIComponent(selected.id)}`} className={SECONDARY_BUTTON}>
                    {t("viewProposals")}<ArrowRight size={16} aria-hidden="true" />
                  </Link>
                  <button type="button" className={PRIMARY_BUTTON} disabled={searching} aria-busy={searching} onClick={() => void searchMore(selected)}>
                    {searching
                      ? <><Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />{t("searching")}</>
                      : <><Search size={16} aria-hidden="true" />{t("searchMore")}</>}
                  </button>
                </div>
              </div>
              {searchError ? (
                <ErrorBanner message={searchError.message}>
                  {searchError.credits ? <Link href="/pricing" className="rounded-md px-2 py-1 font-semibold underline underline-offset-2">{t("buyCredits")}</Link> : null}
                </ErrorBanner>
              ) : null}
              {searchDone !== null ? (
                <p role="status" className="mb-4 flex items-center gap-2 rounded-xl border border-(color:--lime-dark) bg-(--ash-50) px-4 py-3 text-sm font-medium">
                  <CircleCheck size={17} aria-hidden="true" className="text-(color:--lime-dark)" />{t("searchDone", { count: searchDone })}
                </p>
              ) : null}
              {leadsError ? <ErrorBanner message={leadsError} onRetry={() => void loadLeads(selected.id)} /> : null}
              {!leads && !leadsError ? <LoadingState label={t("loadingLeads")} /> : null}
              {/* El contrato acota a 500 leads: la lista simple de LeadsStep entra sin paginar. */}
              {leads ? <LeadsStep leads={leads} campaign={selected} loading={false} /> : null}
            </section>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
