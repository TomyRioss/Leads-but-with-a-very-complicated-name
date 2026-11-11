"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Lead, LeadBatch, SocialNetwork } from "@/lib/types";
import { getLeadColumnValue, getLeadColumns } from "@/lib/types";
import { BrandLogo } from "@/app/brand-logo";
import { LanguageSwitcher } from "@/app/language-switcher";

function displayDate(value: string, locale: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? (locale === "es" ? "Fecha desconocida" : "Unknown date") : new Intl.DateTimeFormat(locale === "es" ? "es-AR" : "en-US", { dateStyle: "medium" }).format(date);
}

function batchDateSlug(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "fecha" : date.toISOString().slice(0, 10);
}

function csvCell(value: string) {
  const safeValue = /^[=+@-]/.test(value.trim()) ? `'${value}` : value;
  return `"${safeValue.replaceAll('"', '""')}"`;
}

function downloadCsv(leads: Lead[], batch: LeadBatch, lotNumber: number, includeEnrichment: boolean) {
  const columns = getLeadColumns(leads, [], includeEnrichment);
  const header = columns.map((column) => csvCell(column.label)).join(",");
  const rows = leads.map((lead) => columns.map((column) => csvCell(getLeadColumnValue(lead, column.key))).join(","));
  const csv = `\uFEFF${[header, ...rows].join("\r\n")}`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `leadta-lote-${lotNumber}-${batchDateSlug(batch.created_at)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function reviewDate(value: string, locale: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale === "es" ? "es-AR" : "en-US", { dateStyle: "medium" }).format(date);
}

type HistoryView = "unified" | "batch";

type AnalysisColumn = "pain_points" | "enrichment";

function LeadSpreadsheet({ leads, unified, lotNumbers, batchDates, onEnrich, enrichingKey, includeEnrichment }: { leads: Lead[]; includeEnrichment: boolean; unified?: boolean; lotNumbers?: Map<string, number>; batchDates?: Map<string, string>; onEnrich?: (lead: Lead, action: AnalysisColumn) => void; enrichingKey?: string }) {
  const t = useTranslations("UI");
  const locale = useLocale();
  const columns = getLeadColumns(leads, [], includeEnrichment);
  return (
    <div className="table-frame history-sheet" tabIndex={0} aria-label={unified ? "Hoja de cálculo de todos tus leads" : "Hoja de cálculo del lote seleccionado"}>
      <table>
        <thead><tr>
          {unified && <><th scope="col">{t("t_bcc476092d")}</th><th scope="col">{t("t_7530a3cd73")}</th></>}
          {columns.map((column) => <th key={column.key} scope="col">{column.label}</th>)}
        </tr></thead>
        <tbody>
          {leads.map((lead) => (
            <tr key={lead.id}>
              {unified && <>
                <td>{displayDate(batchDates?.get(lead.batch) || lead.created_at, locale)}</td>
                <td>{lotNumbers?.get(lead.batch) ? `Lote ${lotNumbers.get(lead.batch)}` : "Lote"}</td>
              </>}
              {columns.map((column) => {
                const value = getLeadColumnValue(lead, column.key);
                const reviewMatch = /^review_([1-5])$/.exec(column.key);
                if (reviewMatch) {
                  const review = lead.source_reviews?.[Number(reviewMatch[1]) - 1];
                  return <td className="lead-review-cell" key={column.key} title={review?.text || ""}>
                    {review && <>
                      <span className="lead-review-meta">{[review.rating === null ? "" : `${review.rating}/5`, review.published_at ? reviewDate(review.published_at, locale) : ""].filter(Boolean).join(" · ")}</span>
                      <span className="lead-review-copy">{review.text}</span>
                      {review.owner_response && <span className="lead-review-response">{t("t_852c5e0706")} {review.owner_response}</span>}
                    </>}
                  </td>;
                }
                const socialNetworkMatch = /^social_(facebook|instagram|youtube|linkedin)$/.exec(column.key);
                if (socialNetworkMatch) {
                  const network = socialNetworkMatch[1] as SocialNetwork;
                  const networkWasSelected = lead.enrichment_detail?.social_networks?.includes(network);
                  return <td key={column.key} title={value}>{value
                    ? <a className="table-link" href={value} target="_blank" rel="noreferrer">{t("t_3afc60274c")}</a>
                    : networkWasSelected ? <span className="analysis-cell-empty is-no-data">{t("t_29b2157143")}</span> : ""}</td>;
                }
                if ((column.key === "maps_url" || column.key === "website") && value) {
                  return <td key={column.key} title={value}><a className="table-link" href={value} target="_blank" rel="noreferrer">{column.key === "maps_url" ? "Abrir Maps" : value}</a></td>;
                }
                if ((column.key === "pain_points" || column.key === "enrichment") && !value) {
                  const detail = column.key === "pain_points" ? lead.pain_points_detail : lead.enrichment_detail;
                  const noData = Boolean(detail?.status || (column.key === "enrichment" && lead.enrichment?.trim()));
                  if (noData) return <td key={column.key}><span className="analysis-cell-empty is-no-data">{t("t_29b2157143")}</span></td>;
                  if (onEnrich) {
                    const action: AnalysisColumn = column.key;
                    const busy = enrichingKey === `${lead.id}:${action}`;
                    return <td key={column.key}><button className="analysis-cell-trigger" type="button" aria-label={`${column.label}: analizar ${lead.name}`} disabled={Boolean(enrichingKey)} onClick={() => onEnrich(lead, action)}>{busy ? "Analizando…" : "Sin analizar"}</button></td>;
                  }
                  return <td key={column.key}><span className="analysis-cell-empty">{t("t_e8526b6c7e")}</span></td>;
                }
                if (column.key === "email" && !value) {
                  const attempted = Boolean(lead.enrichment_detail?.status || lead.enrichment?.trim());
                  if (attempted) return <td key={column.key}><span className="analysis-cell-empty is-no-data">{t("t_29b2157143")}</span></td>;
                  const busy = enrichingKey === `${lead.id}:enrichment`;
                  return <td key={column.key}><button className="analysis-cell-trigger is-enrich" type="button" aria-label={`Mail: enriquecer ${lead.name}`} disabled={Boolean(enrichingKey)} onClick={() => onEnrich?.(lead, "enrichment")}>{busy ? "Enriqueciendo…" : "Enriquecer"}</button></td>;
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
  const t = useTranslations("UI");
  const locale = useLocale();
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
      if (!response.ok) throw new Error(payload.error || "No se pudo cargar el historial.");
      setAllLeads(payload.leads as Lead[]);
      setHistoryPage(Number(payload.page) || page);
      setHistoryTotal(Number(payload.totalItems) || 0);
      setHistoryPages(Math.max(1, Number(payload.totalPages) || 1));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cargar el historial.");
    } finally {
      setLoadingHistory(false);
    }
  }, [router]);

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
      if (!response.ok) throw new Error(payload.error || "No se pudieron cargar los leads de este lote.");
      if (leadsRequest.current === requestId) setLeads(payload.leads as Lead[]);
    } catch (cause) {
      if (leadsRequest.current === requestId) setError(cause instanceof Error ? cause.message : "No se pudieron cargar los leads.");
    } finally {
      if (leadsRequest.current === requestId) setLoadingLeads(false);
    }
  }, [router]);

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
        if (!firstResponse.ok) throw new Error(firstPage.error || "No se pudo cargar el historial.");

        const allBatches = [...firstPage.batches as LeadBatch[]];
        const totalPages = Number(firstPage.totalPages) || 1;
        for (let startPage = 2; startPage <= totalPages; startPage += 4) {
          const pageNumbers = Array.from({ length: Math.min(4, totalPages - startPage + 1) }, (_, index) => startPage + index);
          const responses = await Promise.all(pageNumbers.map((page) => fetch(`/api/batches?page=${page}&perPage=100`, { cache: "no-store" })));
          const pages = await Promise.all(responses.map(async (response) => {
            const payload = await response.json();
            if (response.status === 401) router.replace("/");
            if (!response.ok) throw new Error(payload.error || "No se pudieron cargar todos los lotes.");
            return payload.batches as LeadBatch[];
          }));
          allBatches.push(...pages.flat());
        }
        if (!active) return;
        setBatches(allBatches);
        if (allBatches[0]) setActiveBatchId(allBatches[0].id);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "No se pudo cargar el historial.");
      } finally {
        if (active) setLoadingBatches(false);
      }
    }
    void loadAllBatches();
    return () => { active = false; };
  }, [router]);

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
      if (!response.ok) throw new Error(payload.error || "No se pudo enriquecer este lead.");
      const updatedLeads = new Map((payload.leads as Lead[]).map((item) => [item.id, item]));
      setAllLeads((current) => current.map((item) => updatedLeads.get(item.id) || item));
      setLeads((current) => current.map((item) => updatedLeads.get(item.id) || item));
      if (payload.failedCount) setError("No se pudo completar el análisis de este lead. Quedó marcado como Sin dato.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo enriquecer este lead.");
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
        throw new Error(payload.error || "No se pudo crear el archivo XLSX.");
      }
      const file = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = file;
      anchor.download = `leadta-lote-${activeLotNumber}-${batchDateSlug(activeBatch.created_at)}.xlsx`;
      anchor.click();
      URL.revokeObjectURL(file);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo descargar el XLSX.");
    } finally {
      setDownloadingXlsx(false);
    }
  }

  return (
    <main className="app-shell">
      <nav className="topbar" aria-label="Navegación principal">
        <BrandLogo /><LanguageSwitcher />
        <Link className="history-back-link" href="/">{t("t_3b2e4c6b2b")}</Link>
      </nav>

      <div className={`workspace history-workspace${view === "unified" ? " is-unified" : ""}`}>
        <section className="history-page" aria-labelledby="history-title">
          <header className="history-heading">
            <div>
              <p className="history-eyebrow">{t("t_db5e27b0fd")}</p>
              <h1 id="history-title">{t("t_81c56c10cc")}</h1>
              <p>{t("t_bd2e6d9d99")}</p>
            </div>
            <span className="history-total">{batches.length} {batches.length === 1 ? "lote" : "lotes"}</span>
          </header>

          {error && <div className="history-error" role="alert">{error}</div>}
          {loadingBatches && <p className="history-state" role="status">{t("t_01862eee3c")}</p>}
          {!loadingBatches && !error && batches.length === 0 && (
            <div className="history-empty">
              <h2>{t("t_8644782952")}</h2>
              <p>{t("t_c3cdeb0c72")}</p>
              <Link href="/" className="primary-button history-search-link">{t("t_5f5abb49a3")}</Link>
            </div>
          )}

          {batches.length > 0 && (
            <>
              <div className="history-view-switch" role="group" aria-label="Formato del historial">
                <button type="button" className={view === "unified" ? "is-active" : ""} aria-pressed={view === "unified"} onClick={() => selectHistoryView("unified")}>{t("t_b08069b071")}</button>
                <button type="button" className={view === "batch" ? "is-active" : ""} aria-pressed={view === "batch"} onClick={() => selectHistoryView("batch")}>{t("t_353d3a12cf")}</button>
              </div>

              {view === "unified" && (
                <section className="history-sheet-section" aria-labelledby="unified-history-title">
                  <header className="history-sheet-heading">
                    <div>
                      <h2 id="unified-history-title">{t("t_311210d92a")}</h2>
                      <p>{historyTotal} {historyTotal === 1 ? "negocio guardado" : "negocios guardados"}{t("t_c0546b1f26")}</p>
                    </div>
                  </header>
                  {loadingHistory && <p className="history-state" role="status">{t("t_0c25c1986a")}</p>}
                  {!loadingHistory && !error && allLeads.length === 0 && <p className="history-state">{t("t_60ca93a4a4")}</p>}
                  {allLeads.length > 0 && (
                    <>
                      <p className="history-sheet-hint">{t("t_d28f5fba47")}</p>
                      <LeadSpreadsheet includeEnrichment={isDevelopmentEnvironment} leads={allLeads} unified lotNumbers={lotNumbers} batchDates={batchDates} onEnrich={enrichHistoryLead} enrichingKey={enrichingKey} />
                      <div className="history-sheet-footer">
                        <span>{(historyPage - 1) * 100 + 1}–{Math.min(historyPage * 100, historyTotal)} {t("t_600ccd1b71")} {historyTotal} {t("t_3e05b7f106")}</span>
                        <div className="history-pagination">
                          <button type="button" onClick={() => void loadHistoryPage(historyPage - 1)} disabled={loadingHistory || historyPage <= 1}>{t("t_d97f1097b8")}</button>
                          <span>{t("t_b3a7f96a26")} {historyPage} {t("t_600ccd1b71")} {historyPages}</span>
                          <button type="button" onClick={() => void loadHistoryPage(historyPage + 1)} disabled={loadingHistory || historyPage >= historyPages}>{t("t_c4d83a3b6d")}</button>
                        </div>
                      </div>
                    </>
                  )}
                </section>
              )}

              {view === "batch" && <>
              <div className="history-batch-tabs" role="tablist" aria-label="Lotes generados">
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
                      <strong>{displayDate(batch.created_at, locale)} {t("t_f30cdf14e8")} {lotNumber}</strong>
                      <span>{batch.result_count} {batch.result_count === 1 ? "lead" : "leads"}</span>
                    </button>
                  );
                })}
              </div>

              {activeBatch && (
                <section className="history-sheet-section" role="tabpanel" id="batch-sheet" aria-labelledby={`batch-tab-${activeBatch.id}`}>
                  <header className="history-sheet-heading">
                    <div>
                      <h2>{t("t_7530a3cd73")} {activeLotNumber} <span>·</span> {displayDate(activeBatch.created_at, locale)}</h2>
                      <p>{[activeBatch.district, activeBatch.province, activeBatch.country].filter(Boolean).join(", ")} · {activeBatch.keywords.join(", ")}</p>
                    </div>
                    <div className="history-download-actions">
                      <button type="button" onClick={() => downloadCsv(leads, activeBatch, activeLotNumber, isDevelopmentEnvironment)} disabled={loadingLeads || leads.length === 0}>{t("t_8b9c2038c4")}</button>
                      <button type="button" onClick={() => void downloadXlsx()} disabled={loadingLeads || downloadingXlsx || leads.length === 0}>
                        {downloadingXlsx ? "Creando XLSX…" : "Descargar XLSX"}
                      </button>
                    </div>
                  </header>

                  {loadingLeads && <p className="history-state" role="status">{t("t_0c25c1986a")}</p>}
                  {!loadingLeads && leads.length === 0 && !error && <p className="history-state">{t("t_41d0ac050a")}</p>}
                  {leads.length > 0 && (
                    <>
                      <p className="history-sheet-hint">{t("t_d28f5fba47")}</p>
                      <LeadSpreadsheet includeEnrichment={isDevelopmentEnvironment} leads={leads} onEnrich={enrichHistoryLead} enrichingKey={enrichingKey} />
                      <div className="history-sheet-footer"><span>{leads.length} {leads.length === 1 ? "negocio" : "negocios"}</span><span>{t("t_7530a3cd73")} {activeLotNumber}</span></div>
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
