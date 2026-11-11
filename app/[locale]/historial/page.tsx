"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Lead, LeadBatch, LeadColumnLabeler, SocialNetwork } from "@/lib/types";
import { getLeadColumnValue, getLeadColumns } from "@/lib/types";
import { BrandLogo } from "@/app/brand-logo";
import { LanguageSwitcher } from "@/app/language-switcher";

type DateFormatter = (value: string) => string;

// Etiquetas de columnas: una sola fuente de verdad, el namespace "Search" (también lo usa /buscar).
function useColumnLabel(): LeadColumnLabeler {
  const s = useTranslations("Search");
  return useCallback((key, fallback) => {
    const numbered = /^(review|rating)_([1-5])$/.exec(key);
    if (numbered) return s(`columns.${numbered[1]}`, { number: Number(numbered[2]) });
    return s.has(`columns.${key}`) ? s(`columns.${key}`) : fallback;
  }, [s]);
}
type Translate = ReturnType<typeof useTranslations<"History">>;

function batchDateSlug(value: string, fallback: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString().slice(0, 10);
}

function csvCell(value: string) {
  const safeValue = /^[=+@-]/.test(value.trim()) ? `'${value}` : value;
  return `"${safeValue.replaceAll('"', '""')}"`;
}

function downloadCsv(leads: Lead[], batch: LeadBatch, lotNumber: number, includeEnrichment: boolean, t: Translate, label: LeadColumnLabeler, ownerResponseLabel: string) {
  const columns = getLeadColumns(leads, [], includeEnrichment, label);
  const header = columns.map((column) => csvCell(column.label)).join(",");
  const rows = leads.map((lead) => columns.map((column) => csvCell(getLeadColumnValue(lead, column.key, ownerResponseLabel))).join(","));
  const csv = `\uFEFF${[header, ...rows].join("\r\n")}`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `leadta-${t("fileBatch")}-${lotNumber}-${batchDateSlug(batch.created_at, t("fileDateFallback"))}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

type HistoryView = "unified" | "batch";

type AnalysisColumn = "pain_points" | "enrichment";

function LeadSpreadsheet({ leads, unified, lotNumbers, batchDates, onEnrich, enrichingKey, includeEnrichment }: { leads: Lead[]; includeEnrichment: boolean; unified?: boolean; lotNumbers?: Map<string, number>; batchDates?: Map<string, string>; onEnrich?: (lead: Lead, action: AnalysisColumn) => void; enrichingKey?: string }) {
  const t = useTranslations("History");
  const format = useFormatter();
  const formatDate: DateFormatter = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? t("unknownDate") : format.dateTime(date, { dateStyle: "medium" });
  };
  const reviewDate: DateFormatter = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : format.dateTime(date, { dateStyle: "medium" });
  };
  const columnLabel = useColumnLabel();
  const columns = getLeadColumns(leads, [], includeEnrichment, columnLabel);
  return (
    <div className="table-frame history-sheet" tabIndex={0} aria-label={unified ? t("sheetAllLabel") : t("sheetBatchLabel")}>
      <table>
        <thead><tr>
          {unified && <><th scope="col">{t("colDate")}</th><th scope="col">{t("colBatch")}</th></>}
          {columns.map((column) => <th key={column.key} scope="col">{column.label}</th>)}
        </tr></thead>
        <tbody>
          {leads.map((lead) => (
            <tr key={lead.id}>
              {unified && <>
                <td>{formatDate(batchDates?.get(lead.batch) || lead.created_at)}</td>
                <td>{lotNumbers?.get(lead.batch) ? t("batchLabel", { lot: lotNumbers.get(lead.batch)! }) : t("colBatch")}</td>
              </>}
              {columns.map((column) => {
                const value = getLeadColumnValue(lead, column.key);
                const reviewMatch = /^review_([1-5])$/.exec(column.key);
                if (reviewMatch) {
                  const review = lead.source_reviews?.[Number(reviewMatch[1]) - 1];
                  return <td className="lead-review-cell" key={column.key} title={review?.text || ""}>
                    {review && <>
                      <span className="lead-review-meta">{[review.rating === null ? "" : `${review.rating}/5`, review.published_at ? reviewDate(review.published_at) : ""].filter(Boolean).join(" · ")}</span>
                      <span className="lead-review-copy">{review.text}</span>
                      {review.owner_response && <span className="lead-review-response">{t("ownerResponse")} {review.owner_response}</span>}
                    </>}
                  </td>;
                }
                const socialNetworkMatch = /^social_(facebook|instagram|youtube|linkedin)$/.exec(column.key);
                if (socialNetworkMatch) {
                  const network = socialNetworkMatch[1] as SocialNetwork;
                  const networkWasSelected = lead.enrichment_detail?.social_networks?.includes(network);
                  return <td key={column.key} title={value}>{value
                    ? <a className="table-link" href={value} target="_blank" rel="noreferrer">{t("openProfile")}</a>
                    : networkWasSelected ? <span className="analysis-cell-empty is-no-data">{t("noData")}</span> : ""}</td>;
                }
                if ((column.key === "maps_url" || column.key === "website") && value) {
                  return <td key={column.key} title={value}><a className="table-link" href={value} target="_blank" rel="noreferrer">{column.key === "maps_url" ? t("openMaps") : value}</a></td>;
                }
                if ((column.key === "pain_points" || column.key === "enrichment") && !value) {
                  const detail = column.key === "pain_points" ? lead.pain_points_detail : lead.enrichment_detail;
                  const noData = Boolean(detail?.status || (column.key === "enrichment" && lead.enrichment?.trim()));
                  if (noData) return <td key={column.key}><span className="analysis-cell-empty is-no-data">{t("noData")}</span></td>;
                  if (onEnrich) {
                    const action: AnalysisColumn = column.key;
                    const busy = enrichingKey === `${lead.id}:${action}`;
                    return <td key={column.key}><button className="analysis-cell-trigger" type="button" aria-label={t("analyzeAria", { column: column.label, lead: lead.name })} disabled={Boolean(enrichingKey)} onClick={() => onEnrich(lead, action)}>{busy ? t("analyze") : t("notAnalyzed")}</button></td>;
                  }
                  return <td key={column.key}><span className="analysis-cell-empty">{t("notAnalyzed")}</span></td>;
                }
                if (column.key === "email" && !value) {
                  const attempted = Boolean(lead.enrichment_detail?.status || lead.enrichment?.trim());
                  if (attempted) return <td key={column.key}><span className="analysis-cell-empty is-no-data">{t("noData")}</span></td>;
                  const busy = enrichingKey === `${lead.id}:enrichment`;
                  return <td key={column.key}><button className="analysis-cell-trigger is-enrich" type="button" aria-label={t("enrichEmailAria", { lead: lead.name })} disabled={Boolean(enrichingKey)} onClick={() => onEnrich?.(lead, "enrichment")}>{busy ? t("enriching") : t("enrichEmail")}</button></td>;
                }
                const ratingColumn = /^rating_[1-5]$/.test(column.key);
                return <td key={column.key} className={ratingColumn ? "rating-breakdown-cell" : undefined} title={value}>{value}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function HistoryPage() {
  const t = useTranslations("History");
  const s = useTranslations("Search");
  const columnLabel = useColumnLabel();
  const format = useFormatter();
  const displayDate: DateFormatter = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? t("unknownDate") : format.dateTime(date, { dateStyle: "medium" });
  };
  const router = useRouter();
  const [batches, setBatches] = useState<LeadBatch[]>([]);
  const [view, setView] = useState<HistoryView>("unified");
  const [activeBatchId, setActiveBatchId] = useState("");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [allLeads, setAllLeads] = useState<Lead[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPages, setHistoryPages] = useState(1);
  const [loadingBatches, setLoadingBatches] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [downloadingXlsx, setDownloadingXlsx] = useState(false);
  const [enrichingKey, setEnrichingKey] = useState("");
  const [isDevelopmentEnvironment, setIsDevelopmentEnvironment] = useState(false);
  const [error, setError] = useState("");
  const leadsRequest = useRef(0);

  const loadHistoryPage = useCallback(async (page: number, showLoading = true) => {
    if (showLoading) setLoadingHistory(true);
    setError("");
    try {
      const response = await fetch(`/api/history?page=${page}`, { cache: "no-store" });
      const payload = await response.json();
      if (response.status === 401) {
        router.replace("/");
        return;
      }
      if (!response.ok) throw new Error(payload.error || t("errLoadHistory"));
      setAllLeads(payload.leads as Lead[]);
      setHistoryPage(Number(payload.page) || page);
      setHistoryTotal(Number(payload.totalItems) || 0);
      setHistoryPages(Math.max(1, Number(payload.totalPages) || 1));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("errLoadHistory"));
    } finally {
      setLoadingHistory(false);
    }
  }, [router, t]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/status", { cache: "no-store", signal: controller.signal })
      .then((response) => response.json())
      .then((status) => setIsDevelopmentEnvironment(status.environment === "dev"))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadHistoryPage(1, false); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadHistoryPage]);

  const loadBatchLeads = useCallback(async (batch: LeadBatch) => {
    const requestId = ++leadsRequest.current;
    setActiveBatchId(batch.id);
    setLeads([]);
    setLoadingLeads(true);
    setError("");
    try {
      const response = await fetch(`/api/leads?batchId=${encodeURIComponent(batch.id)}`, { cache: "no-store" });
      const payload = await response.json();
      if (response.status === 401) {
        router.replace("/");
        return;
      }
      if (!response.ok) throw new Error(payload.error || t("errLoadBatchLeads"));
      if (leadsRequest.current === requestId) setLeads(payload.leads as Lead[]);
    } catch (cause) {
      if (leadsRequest.current === requestId) setError(cause instanceof Error ? cause.message : t("errLoadLeads"));
    } finally {
      if (leadsRequest.current === requestId) setLoadingLeads(false);
    }
  }, [router, t]);

  useEffect(() => {
    let active = true;
    async function loadAllBatches() {
      setLoadingBatches(true);
      setError("");
      try {
        const firstResponse = await fetch("/api/batches?page=1&perPage=100", { cache: "no-store" });
        const firstPage = await firstResponse.json();
        if (firstResponse.status === 401) {
          router.replace("/");
          return;
        }
        if (!firstResponse.ok) throw new Error(firstPage.error || t("errLoadHistory"));

        const allBatches = [...firstPage.batches as LeadBatch[]];
        const totalPages = Number(firstPage.totalPages) || 1;
        for (let startPage = 2; startPage <= totalPages; startPage += 4) {
          const pageNumbers = Array.from({ length: Math.min(4, totalPages - startPage + 1) }, (_, index) => startPage + index);
          const responses = await Promise.all(pageNumbers.map((page) => fetch(`/api/batches?page=${page}&perPage=100`, { cache: "no-store" })));
          const pages = await Promise.all(responses.map(async (response) => {
            const payload = await response.json();
            if (response.status === 401) router.replace("/");
            if (!response.ok) throw new Error(payload.error || t("errLoadBatches"));
            return payload.batches as LeadBatch[];
          }));
          allBatches.push(...pages.flat());
        }
        if (!active) return;
        setBatches(allBatches);
        if (allBatches[0]) setActiveBatchId(allBatches[0].id);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : t("errLoadHistory"));
      } finally {
        if (active) setLoadingBatches(false);
      }
    }
    void loadAllBatches();
    return () => { active = false; };
  }, [router, t]);

  const activeBatchIndex = batches.findIndex((batch) => batch.id === activeBatchId);
  const activeBatch = activeBatchIndex < 0 ? null : batches[activeBatchIndex];
  const activeLotNumber = activeBatch ? batches.length - activeBatchIndex : 0;
  const lotNumbers = useMemo(() => new Map(batches.map((batch, index) => [batch.id, batches.length - index])), [batches]);
  const batchDates = useMemo(() => new Map(batches.map((batch) => [batch.id, batch.created_at])), [batches]);

  function selectHistoryView(nextView: HistoryView) {
    setView(nextView);
    if (nextView === "batch" && activeBatch && leads.length === 0 && !loadingLeads) void loadBatchLeads(activeBatch);
  }

  async function enrichHistoryLead(lead: Lead, action: AnalysisColumn) {
    const key = `${lead.id}:${action}`;
    setEnrichingKey(key);
    setError("");
    try {
      const response = await fetch("/api/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId: lead.batch, leadId: lead.id, action }),
      });
      const payload = await response.json();
      if (response.status === 401) {
        router.replace("/");
        return;
      }
      if (!response.ok) throw new Error(payload.error || t("errEnrich"));
      const updatedLeads = new Map((payload.leads as Lead[]).map((item) => [item.id, item]));
      setAllLeads((current) => current.map((item) => updatedLeads.get(item.id) || item));
      setLeads((current) => current.map((item) => updatedLeads.get(item.id) || item));
      if (payload.failedCount) setError(t("errAnalysisFailed"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("errEnrich"));
    } finally {
      setEnrichingKey("");
    }
  }

  async function downloadXlsx() {
    if (!activeBatch) return;
    setDownloadingXlsx(true);
    setError("");
    try {
      const response = await fetch(`/api/export/xlsx?batchId=${encodeURIComponent(activeBatch.id)}`, { cache: "no-store" });
      if (response.status === 401) {
        router.replace("/");
        return;
      }
      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error || t("errXlsxCreate"));
      }
      const file = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = file;
      anchor.download = `leadta-${t("fileBatch")}-${activeLotNumber}-${batchDateSlug(activeBatch.created_at, t("fileDateFallback"))}.xlsx`;
      anchor.click();
      URL.revokeObjectURL(file);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("errXlsxDownload"));
    } finally {
      setDownloadingXlsx(false);
    }
  }

  return (
    <main className="app-shell">
      <nav className="topbar" aria-label={t("navLabel")}>
        <BrandLogo /><LanguageSwitcher />
        <Link className="history-back-link" href="/">{t("backToSearch")}</Link>
      </nav>

      <div className={`workspace history-workspace${view === "unified" ? " is-unified" : ""}`}>
        <section className="history-page" aria-labelledby="history-title">
          <header className="history-heading">
            <div>
              <p className="history-eyebrow">{t("eyebrow")}</p>
              <h1 id="history-title">{t("title")}</h1>
              <p>{t("intro")}</p>
            </div>
            <span className="history-total">{t("batchCount", { count: batches.length })}</span>
          </header>

          {error && <div className="history-error" role="alert">{error}</div>}
          {loadingBatches && <p className="history-state" role="status">{t("loadingBatches")}</p>}
          {!loadingBatches && !error && batches.length === 0 && (
            <div className="history-empty">
              <h2>{t("emptyTitle")}</h2>
              <p>{t("emptyText")}</p>
              <Link href="/" className="primary-button history-search-link">{t("searchLeads")}</Link>
            </div>
          )}

          {batches.length > 0 && (
            <>
              <div className="history-view-switch" role="group" aria-label={t("viewLabel")}>
                <button type="button" className={view === "unified" ? "is-active" : ""} aria-pressed={view === "unified"} onClick={() => selectHistoryView("unified")}>{t("viewUnified")}</button>
                <button type="button" className={view === "batch" ? "is-active" : ""} aria-pressed={view === "batch"} onClick={() => selectHistoryView("batch")}>{t("viewBatch")}</button>
              </div>

              {view === "unified" && (
                <section className="history-sheet-section" aria-labelledby="unified-history-title">
                  <header className="history-sheet-heading">
                    <div>
                      <h2 id="unified-history-title">{t("unifiedTitle")}</h2>
                      <p>{t("unifiedCount", { count: historyTotal })}</p>
                    </div>
                  </header>
                  {loadingHistory && <p className="history-state" role="status">{t("loadingBusinesses")}</p>}
                  {!loadingHistory && !error && allLeads.length === 0 && <p className="history-state">{t("noBusinesses")}</p>}
                  {allLeads.length > 0 && (
                    <>
                      <p className="history-sheet-hint">{t("scrollHint")}</p>
                      <LeadSpreadsheet includeEnrichment={isDevelopmentEnvironment} leads={allLeads} unified lotNumbers={lotNumbers} batchDates={batchDates} onEnrich={enrichHistoryLead} enrichingKey={enrichingKey} />
                      <div className="history-sheet-footer">
                        <span>{t("range", { from: (historyPage - 1) * 100 + 1, to: Math.min(historyPage * 100, historyTotal), total: historyTotal })}</span>
                        <div className="history-pagination">
                          <button type="button" onClick={() => void loadHistoryPage(historyPage - 1)} disabled={loadingHistory || historyPage <= 1}>{t("previous")}</button>
                          <span>{t("pageOf", { page: historyPage, pages: historyPages })}</span>
                          <button type="button" onClick={() => void loadHistoryPage(historyPage + 1)} disabled={loadingHistory || historyPage >= historyPages}>{t("next")}</button>
                        </div>
                      </div>
                    </>
                  )}
                </section>
              )}

              {view === "batch" && <>
              <div className="history-batch-tabs" role="tablist" aria-label={t("tabsLabel")}>
                {batches.map((batch, index) => {
                  const lotNumber = batches.length - index;
                  const selected = batch.id === activeBatchId;
                  return (
                    <button
                      id={`batch-tab-${batch.id}`}
                      className={`history-batch-tab${selected ? " is-active" : ""}`}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      aria-controls="batch-sheet"
                      key={batch.id}
                      onClick={() => void loadBatchLeads(batch)}
                    >
                      <strong>{t("tabTitle", { date: displayDate(batch.created_at), lot: lotNumber })}</strong>
                      <span>{t("tabLeads", { count: batch.result_count })}</span>
                    </button>
                  );
                })}
              </div>

              {activeBatch && (
                <section className="history-sheet-section" role="tabpanel" id="batch-sheet" aria-labelledby={`batch-tab-${activeBatch.id}`}>
                  <header className="history-sheet-heading">
                    <div>
                      <h2>{t("batchHeading", { lot: activeLotNumber, date: displayDate(activeBatch.created_at) })}</h2>
                      <p>{[activeBatch.district, activeBatch.province, activeBatch.country].filter(Boolean).join(", ")} · {activeBatch.keywords.join(", ")}</p>
                    </div>
                    <div className="history-download-actions">
                      <button type="button" onClick={() => downloadCsv(leads, activeBatch, activeLotNumber, isDevelopmentEnvironment, t, columnLabel, s("ownerResponse"))} disabled={loadingLeads || leads.length === 0}>{t("downloadCsv")}</button>
                      <button type="button" onClick={() => void downloadXlsx()} disabled={loadingLeads || downloadingXlsx || leads.length === 0}>
                        {downloadingXlsx ? t("creatingXlsx") : t("downloadXlsx")}
                      </button>
                    </div>
                  </header>

                  {loadingLeads && <p className="history-state" role="status">{t("loadingBusinesses")}</p>}
                  {!loadingLeads && leads.length === 0 && !error && <p className="history-state">{t("noLeads")}</p>}
                  {leads.length > 0 && (
                    <>
                      <p className="history-sheet-hint">{t("scrollHint")}</p>
                      <LeadSpreadsheet includeEnrichment={isDevelopmentEnvironment} leads={leads} onEnrich={enrichHistoryLead} enrichingKey={enrichingKey} />
                      <div className="history-sheet-footer"><span>{t("footerBusinesses", { count: leads.length })}</span><span>{t("footerBatch", { lot: activeLotNumber })}</span></div>
                    </>
                  )}
                </section>
              )}
              </>}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
