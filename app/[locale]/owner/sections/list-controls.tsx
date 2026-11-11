"use client";

import { ChevronLeft, ChevronRight, RefreshCw, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { controlClass, countBadge, ghostButton, sectionHead, sectionTitle, useOwnerFormat } from "../ui";

export function ListToolbar({ title, total, query, onQuery, queryLabel, status, onStatus, statusLabel, allLabel, statusOptions, onRefresh }: {
  title: string;
  total?: number;
  query: string;
  onQuery: (value: string) => void;
  queryLabel?: string;
  status: string;
  onStatus: (value: string) => void;
  statusLabel?: string;
  allLabel?: string;
  statusOptions: { value: string; label: string }[];
  onRefresh: () => void;
}) {
  const t = useTranslations("Owner.common");
  const { formatNumber } = useOwnerFormat();
  const searchText = queryLabel ?? t("searchByEmail");
  return (
    <div className={sectionHead}>
      <h1 className={sectionTitle}>{title}{total === undefined ? null : <span className={countBadge}>{formatNumber(total)}</span>}</h1>
      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
        <label className="relative flex w-full items-center sm:w-auto">
          <Search className="pointer-events-none absolute left-3 text-(color:--ash-600)" size={15} aria-hidden="true" />
          <span className="sr-only">{searchText}</span>
          <input className={`${controlClass} pl-[33px] sm:w-60`} type="search" placeholder={searchText} value={query} onChange={(event) => onQuery(event.target.value)} />
        </label>
        <label className="flex w-full sm:w-auto">
          <span className="sr-only">{statusLabel ?? t("filterByStatus")}</span>
          <select className={`${controlClass} sm:w-44`} value={status} onChange={(event) => onStatus(event.target.value)}>
            <option value="">{allLabel ?? t("allStatuses")}</option>
            {statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <button className={ghostButton} type="button" onClick={onRefresh}><RefreshCw size={15} aria-hidden="true" /> {t("refresh")}</button>
      </div>
    </div>
  );
}

export function Pager({ page, totalPages, loading, onPage }: { page: number; totalPages: number; loading: boolean; onPage: (page: number) => void }) {
  const t = useTranslations("Owner.common");
  if (totalPages <= 1) return null;
  return (
    <nav className="mt-3.5 flex items-center justify-center gap-3.5 text-xs text-(color:--muted)" aria-label={t("pagerLabel")}>
      <button className={ghostButton} type="button" disabled={page <= 1 || loading} onClick={() => onPage(page - 1)}><ChevronLeft size={15} aria-hidden="true" /> {t("pagerPrevious")}</button>
      <span>{t("pagerPage", { page, total: totalPages })}</span>
      <button className={ghostButton} type="button" disabled={page >= totalPages || loading} onClick={() => onPage(page + 1)}>{t("pagerNext")} <ChevronRight size={15} aria-hidden="true" /></button>
    </nav>
  );
}
