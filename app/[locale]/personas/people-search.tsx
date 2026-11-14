"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CircleAlert, CircleCheck, Download, ExternalLink, History as HistoryIcon, LoaderCircle, ScanSearch, Search, Sparkles, UserSearch } from "lucide-react";
import type { IconType } from "react-icons";
import { FaFacebook, FaInstagram, FaLinkedin, FaYoutube } from "react-icons/fa";
import { AppSidebar } from "@/app/app-sidebar";
import { ErrorReportButton } from "@/app/feedback-dialog";
import WhatsAppContact from "@/app/whatsapp-contact";
import { Link, useRouter } from "@/i18n/navigation";
import { painView } from "@/lib/analysis-format";
import { CREDITS_PER_PERSON, type PeopleSearchPlan, type PeopleSearchResponse } from "@/lib/people";
import type { Lead, LeadBatch, SocialNetwork } from "@/lib/types";
import { getSocialProfileUrl } from "@/lib/types";
import { getSession, invalidateSession, peekSessionUser, setSessionCredits } from "@/lib/client/session";

const socialNetworks: { id: SocialNetwork; label: string; Icon: IconType }[] = [
  { id: "facebook", label: "Facebook", Icon: FaFacebook },
  { id: "instagram", label: "Instagram", Icon: FaInstagram },
  { id: "youtube", label: "YouTube", Icon: FaYoutube },
  { id: "linkedin", label: "LinkedIn", Icon: FaLinkedin },
];
const EXAMPLES = ["exampleCleaning", "exampleInsurance", "exampleReact", "exampleAccountant"] as const;
const MAX_COUNT = 25;
// Misma idea que /buscar: vista simplificada por defecto, "Ver todos los datos" muestra cada campo y una columna por red.
type Column = "name" | "role" | "zone" | "whatsapp" | "email" | "socials" | SocialNetwork | "source" | "completeness" | "pains";
const COMPACT_COLUMNS: Column[] = ["name", "whatsapp", "email", "socials", "pains"];
const FULL_COLUMNS: Column[] = ["name", "role", "zone", "whatsapp", "email", ...socialNetworks.map(({ id }) => id), "source", "completeness", "pains"];
const COLUMN_LABEL = { name: "colName", role: "colRole", zone: "colZone", whatsapp: "colWhatsapp", email: "colEmail", socials: "colSocials", source: "colSource", completeness: "colCompleteness", pains: "colPains" } as const;

type User = { email: string; credits: number };
type Preview = { plan: PeopleSearchPlan; estimatedCredits: number };
type Result = Omit<PeopleSearchResponse, "leads"> & { reopened?: boolean };

export function PeopleSearch() {
  const t = useTranslations("people");
  const locale = useLocale() === "en" ? "en" : "es";
  const router = useRouter();
  const [user, setUser] = useState<User | null>(() => { const cached = peekSessionUser(); return cached ? { email: String(cached.email), credits: Number(cached.credits) || 0 } : null; });
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("");
  const [count, setCount] = useState(10);
  const [includeMeta, setIncludeMeta] = useState(true);
  const [showFullData, setShowFullData] = useState(false);
  const columns = showFullData ? FULL_COLUMNS : COMPACT_COLUMNS;
  const [preview, setPreview] = useState<Preview | null>(null);
  const [suggestion, setSuggestion] = useState("");
  const [planning, setPlanning] = useState(false);
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [analyzing, setAnalyzing] = useState<string | null>(null); // "batch" | lead id
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState("");
  const [problem, setProblem] = useState("");
  const [pastBatches, setPastBatches] = useState<LeadBatch[]>([]);
  const [reopening, setReopening] = useState("");
  const busy = planning || searching || Boolean(analyzing);

  // Fresh read after credits change: drop the shared cache first.
  const loadUser = useCallback(() => {
    invalidateSession();
    return getSession().then((payload) => {
      if (!payload.user) router.replace("/");
      else setUser({ email: String(payload.user.email), credits: Number(payload.user.credits) || 0 });
    });
  }, [router]);

  // Historial propio: solo lotes kind = "person" (filtrado en /api/batches).
  const loadPastBatches = useCallback(() => fetch("/api/batches?kind=person&perPage=50", { cache: "no-store" })
    .then((response) => response.ok ? response.json() : null)
    .then((payload) => {
      const list = Array.isArray(payload?.batches) ? payload.batches as LeadBatch[] : [];
      if (Array.isArray(payload?.batches)) setPastBatches(list);
      return list;
    }), []);


  async function reopenBatch(batch: LeadBatch) {
    if (busy || reopening) return;
    setReopening(batch.id);
    setProblem("");
    setNotice("");
    try {
      const response = await fetch(`/api/leads?batchId=${encodeURIComponent(batch.id)}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !Array.isArray(payload?.leads)) throw new Error(payload?.error || t("reopenFailed"));
      const found = payload.leads as Lead[];
      setLeads(found);
      setQuery(batch.query || batch.keywords.join(", "));
      setPreview(null);
      setResult({ batchId: batch.id, plan: batch.plan as PeopleSearchPlan, delivered: found.length, charged: 0, refunded: 0, reopened: true });
      setNotice(t("reopened", { count: found.length }));
    } catch (error) {
      fail(error, t("reopenFailed"));
    } finally {
      setReopening("");
    }
  }

  // First load; ?batch=<id> (e.g. "View all" from Leadtita) reopens that batch. Only the user's own person batches are listed.
  useEffect(() => {
    loadPastBatches().then((list) => {
      const requested = new URLSearchParams(window.location.search).get("batch");
      const target = requested ? list.find((batch) => batch.id === requested) : undefined;
      if (target) void reopenBatch(target);
    }).catch(() => undefined);
  }, [loadPastBatches]); // eslint-disable-line react-hooks/exhaustive-deps -- first load only; reopenBatch reads current state when called

  // Sesión compartida por pestaña (lib/client/session.ts).
  useEffect(() => {
    let current = true;
    getSession()
      .then((payload) => {
        if (!current) return;
        if (!payload.user) router.replace("/");
        else setUser({ email: String(payload.user.email), credits: Number(payload.user.credits) || 0 });
      })
      .catch(() => undefined);
    return () => { current = false; };
  }, [router]);

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    invalidateSession();
    router.replace("/");
  }

  function fail(error: unknown, fallback: string) {
    setNotice("");
    setProblem(error instanceof Error && error.message ? error.message : fallback);
  }

  async function requestPlan(event?: FormEvent) {
    event?.preventDefault();
    if (!query.trim() || busy) return;
    setPlanning(true);
    setProblem("");
    setNotice("");
    setSuggestion("");
    setPreview(null);
    try {
      const response = await fetch("/api/people/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim(), location: location.trim(), locale }),
      });
      const payload = await response.json().catch(() => null);
      if (response.status === 422 && payload?.code === "sensitive_segment") {
        setSuggestion(String(payload.suggestion || ""));
        setProblem(payload.error || t("sensitive"));
        return;
      }
      if (!response.ok) throw new Error(payload?.error || t("planFailed"));
      setPreview({ plan: payload.plan, estimatedCredits: Number(payload.estimatedCredits) || count * CREDITS_PER_PERSON });
    } catch (error) {
      fail(error, t("planFailed"));
    } finally {
      setPlanning(false);
    }
  }

  async function search() {
    if (!preview || busy) return;
    setSearching(true);
    setProblem("");
    setNotice(t("searching"));
    try {
      const response = await fetch("/api/people/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim(), location: location.trim(), count, locale, includeMeta }),
      });
      const payload = await response.json().catch(() => null) as (PeopleSearchResponse & { error?: string }) | null;
      if (!response.ok || !payload) throw new Error(payload?.error || t("searchFailed"));
      const { leads: found, ...summary } = payload;
      setLeads(found);
      setResult(summary);
      setNotice(t("searchDone", { delivered: summary.delivered, charged: summary.charged, refunded: summary.refunded }));
    } catch (error) {
      fail(error, t("searchFailed"));
    } finally {
      setSearching(false);
      loadUser().catch(() => undefined);
      loadPastBatches().catch(() => undefined);
    }
  }

  // Mismo flujo que /buscar: /api/analysis con action pain_points sobre el lote o una fila.
  async function analyze(leadId?: string) {
    if (!result || busy) return;
    setAnalyzing(leadId || "batch");
    setProblem("");
    setNotice(t("analyzing"));
    try {
      const response = await fetch("/api/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId: result.batchId, action: "pain_points", ...(leadId ? { leadId } : {}), focus: preview?.plan.role || query.trim() }),
      });
      const payload = await response.json().catch(() => null);
      if (typeof payload?.credits === "number") { setSessionCredits(payload.credits); setUser((current) => current ? { ...current, credits: payload.credits } : current); }
      if (!response.ok) throw new Error(payload?.error || t("analysisFailed"));
      if (Array.isArray(payload.leads)) setLeads(payload.leads as Lead[]);
      setNotice(t("analysisDone", { count: Number(payload.analyzedCount) || 0 }));
    } catch (error) {
      fail(error, t("analysisFailed"));
    } finally {
      setAnalyzing(null);
    }
  }

  // Reusa el export XLSX por lote de historial.
  async function exportXlsx() {
    if (!result || exporting) return;
    setExporting(true);
    setProblem("");
    try {
      const response = await fetch(`/api/export/xlsx?batchId=${encodeURIComponent(result.batchId)}`, { cache: "no-store" });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || t("exportFailed"));
      }
      const file = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = file;
      anchor.download = `leadta-${t("fileName")}-${new Date().toISOString().slice(0, 10)}.xlsx`;
      anchor.click();
      URL.revokeObjectURL(file);
    } catch (error) {
      fail(error, t("exportFailed"));
    } finally {
      setExporting(false);
    }
  }

  if (!user) return (
    <main className="app-shell">
      <AppSidebar active="people" user={null} onSignOut={signOut} />
      <div className="workspace"><p className="auth-loading people-loading" aria-live="polite"><LoaderCircle className="button-spinner-icon" aria-hidden="true" /> {t("loading")}</p></div>
    </main>
  );

  return (
    <main className="app-shell">
      <AppSidebar active="people" user={user} onSignOut={signOut} />
      <div className="workspace">
        <form className="search-panel people-panel" onSubmit={requestPlan}>
          <div className="panel-heading">
            <div>
              <h1 className="brand-title">{t("pageTitle")}<span className="brand-period" aria-hidden="true">.</span></h1>
              <p>{t("subtitle")}</p>
            </div>
          </div>

          <label className="field people-query-field">
            <span className="field-label">{t("queryLabel")} <span className="required-mark">*</span></span>
            <textarea
              value={query}
              maxLength={300}
              rows={3}
              required
              placeholder={t("queryPlaceholder")}
              onChange={(event) => { setQuery(event.target.value); setPreview(null); }}
              disabled={busy}
            />
          </label>
          <div className="people-examples" role="group" aria-label={t("examplesLabel")}>
            {EXAMPLES.map((key) => (
              <button key={key} type="button" className="people-example" disabled={busy} onClick={() => { setQuery(t(key)); setPreview(null); }}>
                <Sparkles size={16} aria-hidden="true" /> {t(key)}
              </button>
            ))}
          </div>

          <div className="people-row">
            <label className="field">
              <span className="field-label">{t("locationLabel")}</span>
              <input type="text" value={location} maxLength={160} placeholder={t("locationPlaceholder")} onChange={(event) => { setLocation(event.target.value); setPreview(null); }} disabled={busy} />
            </label>
            <label className="field people-count-field">
              <span className="field-label">{t("countLabel")}</span>
              <input
                type="number"
                min={1}
                max={MAX_COUNT}
                value={count}
                onChange={(event) => setCount(Math.min(MAX_COUNT, Math.max(1, Math.trunc(Number(event.target.value)) || 1)))}
                disabled={busy}
              />
            </label>
          </div>

          <label className="full-data-toggle">
            <input type="checkbox" role="switch" checked={includeMeta} onChange={(event) => setIncludeMeta(event.target.checked)} disabled={busy} />
            <span className="full-data-track" aria-hidden="true" />
            <span>{t("includeMeta")}</span>
          </label>

          <div className="search-action people-actions">
            <button className={preview ? "export-button" : "primary-button"} type="submit" disabled={busy || !query.trim()}>
              {planning ? <><LoaderCircle className="button-spinner-icon" aria-hidden="true" /> {t("planning")}</> : <><ScanSearch size={18} aria-hidden="true" /> {t("previewButton")}</>}
            </button>
            {preview && (
              <button className="primary-button" type="button" disabled={busy} onClick={() => void search()}>
                {searching ? <><span className="button-spinner" aria-hidden="true" /> {t("searchingShort")}</> : <><Search size={18} aria-hidden="true" /> {t("searchButton")}</>}
              </button>
            )}
          </div>

          {preview && (
            <div className="people-preview" role="status">
              <strong>{t("previewTitle")}</strong>
              <p>{preview.plan.summary}</p>
              <p className="field-help">
                {t("previewCost", { credits: count * CREDITS_PER_PERSON, perPerson: CREDITS_PER_PERSON })}
              </p>
            </div>
          )}
          {suggestion && (
            <div className="people-preview">
              <strong>{t("suggestionTitle")}</strong>
              <p>{suggestion}</p>
              <button className="export-button" type="button" onClick={() => { setQuery(suggestion); setSuggestion(""); setProblem(""); }}>{t("useSuggestion")}</button>
            </div>
          )}
        </form>

        {(problem || notice) && (
          <div className={`status-message${problem ? " is-error" : " is-success"}`} role={problem ? "alert" : "status"}>
            {problem
              ? <CircleAlert className="status-icon" size={19} strokeWidth={2} aria-hidden="true" />
              : <CircleCheck className="status-icon" size={19} strokeWidth={2} aria-hidden="true" />}
            <span>{problem || notice}</span>
            {problem && <ErrorReportButton message={problem} action={searching ? "people:search" : analyzing ? "people:analysis" : "people"} />}
            {problem && <button type="button" className="dismiss-button" onClick={() => setProblem("")}>{t("dismiss")}</button>}
          </div>
        )}

        {pastBatches.length > 0 && (
          <section className="people-history" aria-labelledby="people-history-title">
            <h2 id="people-history-title"><HistoryIcon size={16} aria-hidden="true" /> {t("historyTitle")}</h2>
            <ul>
              {pastBatches.map((batch) => (
                <li key={batch.id}>
                  <button type="button" className={`people-history-item${result?.batchId === batch.id ? " is-active" : ""}`} aria-current={result?.batchId === batch.id ? "true" : undefined} disabled={busy || Boolean(reopening)} onClick={() => void reopenBatch(batch)}>
                    <strong>{batch.query || batch.keywords.join(", ")}</strong>
                    <span>{[new Date(batch.created_at).toLocaleDateString(locale === "es" ? "es-AR" : "en-US", { dateStyle: "medium" }), batch.country !== "-" ? batch.country : "", t("historyCount", { count: batch.result_count })].filter(Boolean).join(" · ")}</span>
                    {reopening === batch.id && <LoaderCircle className="button-spinner-icon" aria-hidden="true" />}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="results-section" aria-labelledby="people-results-title" aria-busy={searching}>
          <div className="results-heading">
            <div>
              <div className="results-title-row">
                <h2 id="people-results-title">{t("resultsTitle")}</h2>
                <span className="result-count">{leads.length}</span>
              </div>
              {result && !result.reopened && <p className="active-location">{t("billing", { charged: result.charged, refunded: result.refunded })}</p>}
            </div>
            <div className="results-actions">
              <label className="full-data-toggle">
                <input type="checkbox" role="switch" checked={showFullData} onChange={(event) => setShowFullData(event.target.checked)} />
                <span className="full-data-track" aria-hidden="true" />
                <span>{t("showFullData")}</span>
              </label>
              <button className="export-button" type="button" disabled={!result || leads.length === 0 || busy} onClick={() => void analyze()}>
                {analyzing === "batch" ? <><LoaderCircle className="button-spinner-icon" aria-hidden="true" /> {t("analyzingShort")}</> : t("analyzeBatch")}
              </button>
              {result && <Link className="export-button people-link-button" href="/historial">{t("openHistory")}</Link>}
              <button className="export-button" type="button" disabled={!result || leads.length === 0 || exporting} onClick={() => void exportXlsx()}>
                {exporting ? <><LoaderCircle className="button-spinner-icon" aria-hidden="true" /> {t("exporting")}</> : <><Download size={16} aria-hidden="true" /> {t("export")}</>}
              </button>
            </div>
          </div>

          {searching && <p className="people-progress" role="status"><LoaderCircle className="button-spinner-icon" aria-hidden="true" /> {t("progress")}</p>}

          <div className="table-frame" tabIndex={0} aria-label={t("tableAria")}>
            <table className={showFullData ? "people-table is-full" : "compact-lead-table people-table"}>
              <thead>
                <tr>
                  {columns.map((column) => <th key={column} scope="col">{column in COLUMN_LABEL ? t(COLUMN_LABEL[column as keyof typeof COLUMN_LABEL]) : socialNetworks.find(({ id }) => id === column)?.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => {
                  const whatsapp = lead.whatsapp || lead.phone;
                  const profiles = socialNetworks.flatMap(({ id, label, Icon }) => {
                    const url = getSocialProfileUrl(lead.social_profiles || "", id);
                    return url ? [{ id, label, Icon, url }] : [];
                  });
                  const pains = painView(lead.pain_points_detail, lead.pain_points);
                  const completeness = Math.max(0, Math.min(4, Number(lead.completeness) || 0));
                  const missing = <span className="compact-missing">{t("noData")}</span>;
                  const cell = (column: Column) => {
                    switch (column) {
                      case "name": return <strong className="compact-business-name">{lead.name}</strong>;
                      case "role": return lead.role || lead.category || "—";
                      case "zone": return lead.location || lead.address || "—";
                      case "whatsapp": return whatsapp ? <WhatsAppContact phone={whatsapp} /> : missing;
                      case "email": return lead.email ? <a className="table-link" href={`mailto:${lead.email}`}>{lead.email}</a> : missing;
                      case "socials": return profiles.length
                        ? <div className="compact-social-links">{profiles.map(({ id, label, Icon, url }) => (
                          <a className={`social-pill is-${id}`} key={id} href={url} target="_blank" rel="noreferrer" title={url}>
                            <Icon aria-hidden="true" /><span>{label}</span>
                          </a>
                        ))}</div>
                        : missing;
                      case "source": return lead.source_url
                        ? <a className="table-link" href={lead.source_url} target="_blank" rel="noreferrer">{t(`source.${lead.source || "web"}`)} <ExternalLink size={12} aria-hidden="true" /></a>
                        : t(`source.${lead.source || "web"}`);
                      case "completeness": return (
                        <span className="people-completeness" role="img" aria-label={t("completenessAria", { value: completeness })}>
                          {[0, 1, 2, 3].map((index) => <span key={index} className={index < completeness ? "is-on" : undefined} />)}
                        </span>
                      );
                      case "pains": return pains.tags.length
                        ? <>
                          <span className="pain-tags">{pains.tags.map((tag) => <span className="pain-tag" key={tag} title={pains.report}>{tag}</span>)}</span>
                          {showFullData && pains.report && <span className="pain-report">{pains.report}</span>}
                        </>
                        : <button className="analysis-cell-trigger" type="button" disabled={busy} aria-label={t("analyzeRowAria", { name: lead.name })} onClick={() => void analyze(lead.id)}>
                          {analyzing === lead.id ? <LoaderCircle className="button-spinner-icon" aria-hidden="true" /> : t("analyzeRow")}
                        </button>;
                      default: {
                        const url = profiles.find(({ id }) => id === column)?.url;
                        return url ? <a className="table-link" href={url} target="_blank" rel="noreferrer">{url}</a> : missing;
                      }
                    }
                  };
                  return (
                    <tr key={lead.id}>
                      {columns.map((column) => <td key={column} className={column === "pains" ? "people-pains-cell" : undefined}>{cell(column)}</td>)}
                    </tr>
                  );
                })}
                {leads.length === 0 && !searching && (
                  <tr><td className="empty-cell" colSpan={columns.length}><span className="people-empty-icon" aria-hidden="true"><UserSearch size={20} /></span><strong>{t("emptyTitle")}</strong><span>{t("emptyHint")}</span></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
