"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { Lead, LeadBatch } from "@/lib/types";
import { LEAD_COLUMNS } from "@/lib/types";
import { AuthForm } from "./auth-form";
import { BrandLogo } from "./brand-logo";

const productionBatchSizes = [5, 10, 15, 20, 25, 30];

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function downloadCsv(leads: Lead[], batch: LeadBatch | null) {
  const header = LEAD_COLUMNS.map((column) => csvCell(column.label)).join(",");
  const rows = leads.map((lead) => LEAD_COLUMNS.map((column) => csvCell(lead[column.key])).join(","));
  const csv = `\uFEFF${[header, ...rows].join("\r\n")}`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `leadta-${batch?.country.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "leads"}-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function placeLabel(batch: LeadBatch) {
  return [batch.district, batch.province, batch.country].filter(Boolean).join(", ");
}

export default function Home() {
  const [keywordsText, setKeywordsText] = useState("");
  const [country, setCountry] = useState("");
  const [province, setProvince] = useState("");
  const [district, setDistrict] = useState("");
  const [count, setCount] = useState(10);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [batches, setBatches] = useState<LeadBatch[]>([]);
  const [activeBatch, setActiveBatch] = useState<LeadBatch | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [problem, setProblem] = useState("");
  const [historyLoading, setHistoryLoading] = useState(true);
  const [apifyConfigured, setApifyConfigured] = useState(false);
  const [pocketBaseConfigured, setPocketBaseConfigured] = useState(false);
  const [isDevelopmentEnvironment, setIsDevelopmentEnvironment] = useState(false);
  const [currentUser, setCurrentUser] = useState<{ id: string; email: string } | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authProblem, setAuthProblem] = useState("");
  const batchSizes = isDevelopmentEnvironment ? [1, 2, ...productionBatchSizes] : productionBatchSizes;

  const keywords = useMemo(
    () => [...new Set(keywordsText.split(/[\n,;]+/).map((keyword) => keyword.trim()).filter(Boolean))],
    [keywordsText],
  );

  useEffect(() => {
    let current = true;
    async function loadInitialData() {
      try {
        const authResponse = await fetch("/api/auth/me", { cache: "no-store" });
        const authPayload = await authResponse.json();
        if (!authResponse.ok) throw new Error(authPayload.error || "No se pudo conectar con tu cuenta.");
        if (!current) return;
        if (!authPayload.user) {
          setHistoryLoading(false);
          setAuthLoading(false);
          return;
        }
        setCurrentUser(authPayload.user);
        setAuthLoading(false);

        const statusResponse = await fetch("/api/status", { cache: "no-store" });
        const status = await statusResponse.json();
        if (current) {
          setApifyConfigured(Boolean(status.apifyConfigured));
          setPocketBaseConfigured(Boolean(status.pocketBaseConfigured));
          setIsDevelopmentEnvironment(status.environment === "dev");
        }

        const response = await fetch("/api/batches", { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "No se pudo cargar el historial.");
        if (!current) return;

        const loadedBatches = payload.batches as LeadBatch[];
        setBatches(loadedBatches);
        setHistoryLoading(false);
        if (loadedBatches.length === 0) return;

        const latest = loadedBatches[0];
        setActiveBatch(latest);
        const query = new URLSearchParams({ batchId: latest.id });
        const leadsResponse = await fetch(`/api/leads?${query}`, { cache: "no-store" });
        const leadsPayload = await leadsResponse.json();
        if (current && leadsResponse.ok) setLeads(leadsPayload.leads);
      } catch (error) {
        if (!current) return;
        setAuthProblem(error instanceof Error ? error.message : "No se pudo conectar con tu cuenta.");
        setAuthLoading(false);
        setHistoryLoading(false);
        setProblem(error instanceof Error ? error.message : "No se pudo conectar con el historial.");
      }
    }
    void loadInitialData();
    return () => { current = false; };
  }, []);

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    setCurrentUser(null);
    setBatches([]);
    setLeads([]);
    setActiveBatch(null);
  }

  async function selectBatch(batch: LeadBatch) {
    setActiveBatch(batch);
    setProblem("");
    setNotice("");
    try {
      const query = new URLSearchParams({ batchId: batch.id });
      const response = await fetch(`/api/leads?${query}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No se pudo cargar el lote.");
      setLeads(payload.leads);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "No se pudo cargar el lote.");
    }
  }

  async function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProblem("");
    setNotice("");
    if (!keywords.length) {
      setProblem("Ingresá al menos una keyword.");
      return;
    }
    if (!country.trim()) {
      setProblem("El país es obligatorio para iniciar la búsqueda.");
      return;
    }

    setBusy(true);
    setLeads([]);
    setActiveBatch(null);
    setNotice("Buscando negocios y guardando el lote…");

    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywords, country, province, district, count }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No se pudo completar la búsqueda.");

      const newBatch = ((await fetch("/api/batches", { cache: "no-store" }).then((result) => result.json())).batches as LeadBatch[])
        .find((batch) => batch.id === payload.batchId);
      setLeads(payload.leads as Lead[]);
      if (newBatch) {
        setBatches((previous) => [newBatch, ...previous.filter((batch) => batch.id !== newBatch.id)].slice(0, 20));
        setActiveBatch(newBatch);
      }
      setNotice(`${payload.leads.length} leads guardados en el lote.`);
      if (payload.warning) setProblem(`El lote quedó parcial. ${payload.warning}`);
    } catch (error) {
      setNotice("");
      setProblem(error instanceof Error ? error.message : "No se pudo completar la búsqueda.");
    } finally {
      setBusy(false);
    }
  }

  if (authLoading) return <main className="app-shell auth-loading" aria-live="polite">Conectando con tu cuenta…</main>;
  if (!currentUser) return <AuthForm initialError={authProblem} onAuthenticated={() => window.location.reload()} />;

  return (
    <main className="app-shell">
      <header className="topbar">
        <BrandLogo />
        <div className="topbar-user"><span className="connection-dot" /><span>{currentUser.email}</span><button type="button" className="logout-button" onClick={() => void signOut()}>Salir</button></div>
      </header>

      <div className="workspace">
        <section className="page-heading" aria-labelledby="page-title">
          <div>
            <h1 id="page-title">Encontrá tu próximo lead.</h1>
            <p className="page-intro">Buscá empresas por rubro y zona. Los resultados quedan guardados para revisar o exportar.</p>
          </div>
          <div className="apify-badge"><span className="apify-spark" aria-hidden="true">A</span> Google Maps</div>
        </section>

        <form className="search-panel" onSubmit={submitSearch}>
          <div className="panel-heading">
            <div>
              <h2>Configurar búsqueda</h2>
              <p>Elegí qué negocios buscar y hasta dónde.</p>
            </div>
            <span className="required-note"><span aria-hidden="true">*</span> Obligatorio</span>
          </div>

          <div className="form-grid">
            <label className="field field-keywords">
              <span className="field-label">Keywords <span className="required-mark">*</span></span>
              <textarea
                value={keywordsText}
                onChange={(event) => setKeywordsText(event.target.value)}
                placeholder={'Ej.: estudios contables\ninmobiliarias'}
                rows={3}
                maxLength={1200}
                aria-describedby="keywords-help"
                required
              />
              <span className="field-help" id="keywords-help">Una keyword por línea. También podés separarlas con coma.</span>
            </label>

            <div className="field geography-field">
              <span className="field-label">Zona de búsqueda <span className="required-mark">*</span></span>
              <div className="location-grid">
                <label>
                  <span className="sr-only">País obligatorio</span>
                  <input value={country} onChange={(event) => setCountry(event.target.value)} placeholder="País (obligatorio)" maxLength={100} required />
                </label>
                <label>
                  <span className="sr-only">Provincia opcional</span>
                  <input value={province} onChange={(event) => setProvince(event.target.value)} placeholder="Provincia (opcional)" maxLength={100} />
                </label>
                <label>
                  <span className="sr-only">Distrito opcional</span>
                  <input value={district} onChange={(event) => setDistrict(event.target.value)} placeholder="Distrito (opcional)" maxLength={100} />
                </label>
              </div>
              <span className="field-help">El país define el área mínima. Provincia y distrito la acotan.</span>
            </div>

            <fieldset className="field batch-field">
              <legend className="field-label">Cantidad por lote{isDevelopmentEnvironment && <span className="test-mode-label">Testing: 1–2</span>}</legend>
              <div className="batch-options" role="radiogroup" aria-label="Cantidad de leads por lote">
                {batchSizes.map((size) => (
                  <label className={`batch-option${count === size ? " is-selected" : ""}`} key={size}>
                    <input type="radio" name="batch-size" value={size} checked={count === size} onChange={() => setCount(size)} />
                    <span>{size}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="search-action">
              <button className="primary-button" type="submit" disabled={busy || !apifyConfigured || !pocketBaseConfigured || keywords.length === 0 || !country.trim()}>
                {busy ? <><span className="button-spinner" aria-hidden="true" /> Buscando leads…</> : "Buscar leads"}
              </button>
              <span className="action-caption">{!apifyConfigured ? "Falta configurar APIFY_TOKEN en el servidor" : !pocketBaseConfigured ? "Falta conectar PocketBase" : `${keywords.length} ${keywords.length === 1 ? "keyword" : "keywords"} · máximo ${count}`}</span>
            </div>
          </div>
          <p className="cost-note">La extracción de emails se activa para los negocios con website. Apify puede cobrar este complemento aparte.</p>
        </form>

        {(problem || notice) && (
          <div className={`status-message${problem ? " is-error" : " is-success"}`} role={problem ? "alert" : "status"}>
            <span className="status-indicator" aria-hidden="true" />
            <span>{problem || notice}</span>
            {problem && <button type="button" className="dismiss-button" onClick={() => setProblem("")}>Cerrar</button>}
          </div>
        )}

        <section className="results-section" aria-labelledby="results-title">
          <div className="results-heading">
            <div>
              <div className="results-title-row">
                <h2 id="results-title">Leads encontrados</h2>
                <span className="result-count">{leads.length}</span>
              </div>
              {activeBatch && <p className="active-location">{placeLabel(activeBatch)} <span>·</span> {activeBatch.keywords.join(", ")}</p>}
            </div>
            <button className="export-button" type="button" onClick={() => downloadCsv(leads, activeBatch)} disabled={leads.length === 0}>
              Descargar CSV
            </button>
          </div>

          {batches.length > 0 && (
            <div className="batch-history" aria-label="Historial de lotes">
              <span className="history-label">LOTE</span>
              <div className="history-list">
                {batches.slice(0, 6).map((batch) => (
                  <button
                    key={batch.id}
                    className={`history-chip${activeBatch?.id === batch.id ? " is-active" : ""}`}
                    type="button"
                    onClick={() => void selectBatch(batch)}
                    title={`${batch.keywords.join(", ")} · ${placeLabel(batch)}`}
                  >
                    <span>{batch.result_count}/{batch.requested_count}</span>
                    <span>{batch.keywords[0] || "Búsqueda"}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <p className="table-scroll-hint">Deslizá la tabla para ver todas las columnas.</p>
          <div className="table-frame" tabIndex={0} aria-label="Resultados de leads, desplazables horizontalmente">
            <table>
              <thead>
                <tr>{LEAD_COLUMNS.map((column) => <th key={column.key} scope="col">{column.label}</th>)}</tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <tr key={lead.id}>
                    {LEAD_COLUMNS.map((column) => {
                      const value = lead[column.key];
                      const isLink = (column.key === "maps_url" || column.key === "website") && Boolean(value);
                      return (
                        <td key={column.key}>
                          {isLink ? <a className="table-link" href={String(value)} target="_blank" rel="noreferrer" title={String(value)}>{column.key === "maps_url" ? "Google Maps" : String(value)}</a> : value == null ? "" : String(value)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {leads.length === 0 && !busy && (
                  <tr><td className="empty-cell" colSpan={LEAD_COLUMNS.length}>
                    <strong>{historyLoading ? "Conectando con tu historial…" : "Todavía no hay leads"}</strong>
                    <span>{historyLoading ? "" : "Completá una keyword y la zona para generar el primer lote."}</span>
                  </td></tr>
                )}
                {busy && Array.from({ length: Math.min(count, 5) }, (_, index) => (
                  <tr className="skeleton-row" key={`skeleton-${index}`} aria-hidden="true">
                    {LEAD_COLUMNS.map((column) => <td key={column.key}><span /></td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-footer"><span>Los datos faltantes quedan en blanco.</span><span>{leads.length} {leads.length === 1 ? "registro" : "registros"}</span></div>
        </section>
      </div>
    </main>
  );
}
