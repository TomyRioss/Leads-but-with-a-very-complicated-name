"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight, Building2, Check, Compass, MapPin, Plus, Search } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import { Favicon } from "@/app/[locale]/explorar/explore-steps";
import type { Business } from "@/lib/workspace/types";
import { CARD, EmptyState, ErrorBanner, LABEL, LoadingState, PageHeader, PRIMARY_BUTTON, SECONDARY_BUTTON, requestJson, useErrorMessage } from "@/app/workspace/workspace-ui";

function cleanDomain(value: string) {
  return value.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/.*$/, "");
}

function BusinessCard({ business }: { business: Business }) {
  const t = useTranslations("Workspace.businesses");
  const titleId = `business-${business.id}`;
  return (
    <article className={`${CARD} @container`} aria-labelledby={titleId}>
      <div className="flex flex-wrap items-center gap-4">
        <Favicon domain={business.domain} size={48} />
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="truncate text-lg font-semibold tracking-tight">{business.name}</h2>
          {business.domain ? <p className="truncate text-sm text-(color:--muted)">{cleanDomain(business.domain)}</p> : null}
        </div>
        <Link href={`/campanas?business=${encodeURIComponent(business.id)}`} className={SECONDARY_BUTTON}>
          {t("viewCampaigns")}<ArrowRight size={16} aria-hidden="true" />
        </Link>
      </div>
      {business.summary ? <p className="mt-4 max-w-3xl text-[15px] leading-relaxed text-(color:--ash-800)">{business.summary}</p> : null}
      <p className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-(color:--line) bg-(--ash-50) px-3 py-1 text-xs text-(color:--ash-700)">
        <MapPin size={13} aria-hidden="true" />{t("location")}: {business.location || t("noLocation")}
      </p>

      <div className="mt-6 grid grid-cols-1 gap-6 border-t border-(color:--line) pt-5 @xl:grid-cols-2">
        {business.headline || business.valueProps.length ? (
          <div>
            <h3 className={LABEL}>{t("valueProps")}</h3>
            {business.headline ? <p className="mt-2 font-semibold tracking-tight">{business.headline}</p> : null}
            <ul className="mt-2 space-y-1.5">
              {business.valueProps.map((item) => (
                <li key={item} className="flex min-w-0 items-start gap-2 text-sm wrap-anywhere text-(color:--ash-800)">
                  <Check size={16} className="mt-0.5 shrink-0 text-(color:--lime-dark)" aria-hidden="true" />{item}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {business.buyerSearches.length ? (
          <div>
            <h3 className={LABEL}>{t("buyerSearches")}</h3>
            <ul className="mt-3 flex flex-wrap gap-2">
              {business.buyerSearches.map((item) => (
                <li key={item} className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full wrap-anywhere border border-(color:--line) bg-(--ash-50) px-3 py-1.5 text-xs text-(color:--ash-800)">
                  <Search size={13} className="text-(color:--muted)" aria-hidden="true" />{item}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="mt-6">
        <div className="flex items-center gap-2">
          <h3 className={LABEL}>{t("competitors")}</h3>
          <span className="rounded-full bg-(--ash-150) px-2 py-0.5 text-[11px] font-semibold text-(color:--ash-700)">{t("competitorsCount", { count: business.competitors.length })}</span>
        </div>
        {business.competitors.length ? (
          <ul className="mt-3 grid grid-cols-1 gap-3 @md:grid-cols-2 @4xl:grid-cols-4">
            {business.competitors.map((item) => (
              <li key={item.domain || item.name} className="flex min-w-0 items-center gap-3 rounded-lg border border-(color:--line) bg-(--ash-50) p-3">
                <Favicon domain={item.domain} size={32} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{item.name}</p>
                  {item.domain ? <p className="truncate text-xs text-(color:--muted)">{cleanDomain(item.domain)}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </article>
  );
}

export function BusinessesView() {
  const t = useTranslations("Workspace.businesses");
  const tSwitcher = useTranslations("BusinessSwitcher");
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const [businesses, setBusinesses] = useState<Business[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    const result = await requestJson<{ businesses: Business[] }>("/api/businesses");
    if (result.ok) setBusinesses(result.data.businesses ?? []);
    else if (result.status === 401) router.replace("/");
    else setError(errorMessage(result.error, result.status, t("errLoad")));
  }, [errorMessage, router, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  return (
    <section aria-labelledby="businesses-title">
      <PageHeader id="businesses-title" title={t("title")} intro={t("intro")} count={businesses ? t("count", { count: businesses.length }) : undefined}>
        {businesses?.length ? <Link href="/" className={SECONDARY_BUTTON}><Compass size={16} aria-hidden="true" />{t("emptyCta")}</Link> : null}
        <Link href="/onboarding?new=1" className={PRIMARY_BUTTON}><Plus size={16} aria-hidden="true" />{tSwitcher("newBusiness")}</Link>
      </PageHeader>
      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
      {!businesses && !error ? <LoadingState label={t("loading")} /> : null}
      {businesses && businesses.length === 0 ? (
        <EmptyState Icon={Building2} title={t("emptyTitle")} text={t("emptyText")} cta={{ href: "/", label: t("emptyCta"), Icon: Compass }} />
      ) : null}
      {businesses?.length ? (
        <ul className="space-y-5">
          {businesses.map((business) => <li key={business.id}><BusinessCard business={business} /></li>)}
        </ul>
      ) : null}
    </section>
  );
}
