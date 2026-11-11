"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { Bug, ChevronDown, CircleAlert, CircleCheck, ExternalLink, History, LoaderCircle, LogOut, Stars, X } from "lucide-react";
import type { AnalysisDetail, Lead, LeadBatch, LeadColumnKey } from "@/lib/types";
import { getLeadColumnValue, getLeadColumns } from "@/lib/types";
import { AuthForm } from "@/app/auth-form";
import { BrandLogo } from "@/app/brand-logo";
import { LanguageSwitcher } from "@/app/language-switcher";
import CellDetailsPopover from "@/app/cell-details-popover";
import WhatsAppContact from "@/app/whatsapp-contact";

const productionBatchSizes = [5, 10, 25, 50, 75, 100, 125, 150];
const tableActions = {
  pain_points: {
    title: "Buscar dolores",
    description: "Prioriza reseñas negativas y resume hasta 3 dolores concretos.",
    cta: "Analizar dolores del lote",
  },
  enrichment: {
    title: "Enriquecer Lead",
    description: "Busca perfiles y publicaciones públicas en las redes seleccionadas y verifica que correspondan al lead.",
    cta: "Enriquecer lote",
  },
} as const;
type TableAction = keyof typeof tableActions;
type AnalysisScope = "row" | "batch";
type SocialNetwork = "facebook" | "instagram" | "youtube" | "linkedin";
type AnalysisDiagnostic = {
  leadId: string;
  leadName: string;
  model: string;
  webSearchEngine: string;
  webFetchEngine: string;
  webSearchRequests: number;
  toolCallsExecuted: number;
  savedReviewCount: number;
  detailsStatus: string;
  mapsUrl: string;
  response: string;
};
const socialNetworkOptions: { id: SocialNetwork; label: string }[] = [
  { id: "facebook", label: "Facebook" },
  { id: "instagram", label: "Instagram" },
  { id: "youtube", label: "YouTube" },
  { id: "linkedin", label: "LinkedIn" },
];
type TableColumn = { key: LeadColumnKey | "whatsapp"; label: string };
type FilterChoice = "any" | "with" | "without";
type GeographyOption = { code: string; name: string };
type SearchFilters = {
  minReviews: string;
  minRating: string;
  website: FilterChoice;
  phone: FilterChoice;
  email: FilterChoice;
  skipClosed: boolean;
};
function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function downloadCsv(leads: Lead[], batch: LeadBatch | null, includeEnrichment: boolean) {
  const columns = getLeadColumns(leads, [], includeEnrichment);
  const header = columns.map((column) => csvCell(column.label)).join(",");
  const rows = leads.map((lead) => columns.map((column) => csvCell(getLeadColumnValue(lead, column.key))).join(","));
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

function reviewDate(value: string, locale: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale === "es" ? "es-AR" : "en-US", { dateStyle: "medium" }).format(date);
}

function analysisDetail(value: unknown): AnalysisDetail | null {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  const detail = value as Partial<AnalysisDetail>;
  return typeof detail.summary === "string" && Array.isArray(detail.findings) ? detail as AnalysisDetail : null;
}

function parseKeywords(value: string) {
  return [...new Set(value.split(/[\n,;]+/).map((keyword) => keyword.trim()).filter(Boolean))];
}

const KeywordsField = memo(function KeywordsField() {
  const t = useTranslations("UI");
  const [value, setValue] = useState("");
  const keywordCount = parseKeywords(value).length;

  return (
    <label className="field field-keywords">
      <span className="field-label">{t("t_f530db58b3")} <span className="required-mark">*</span></span>
      <textarea
        name="keywords"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={'Ej.: estudios contables\ninmobiliarias'}
        rows={3}
        maxLength={1200}
        aria-describedby="keywords-help"
        required
      />
      <span className="field-help" id="keywords-help">
        {t("t_ed5451877b")}{keywordCount > 0 && <> <strong>{keywordCount} {keywordCount === 1 ? "keyword" : "keywords"}</strong></>}
      </span>
    </label>
  );
});

export default function Home() {
  const t = useTranslations("UI");
  const locale = useLocale();
  const [country, setCountry] = useState("");
  const [province, setProvince] = useState("");
  const [district, setDistrict] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [provinceCode, setProvinceCode] = useState("");
  const [countries, setCountries] = useState<GeographyOption[]>([]);
  const [provinces, setProvinces] = useState<GeographyOption[]>([]);
  const [districts, setDistricts] = useState<GeographyOption[]>([]);
  const [geographyLoading, setGeographyLoading] = useState({ countries: true, provinces: false, districts: false });
  const [geographyError, setGeographyError] = useState("");
  const [count, setCount] = useState(25);
  const [filters, setFilters] = useState<SearchFilters>({
    minReviews: "", minRating: "", website: "any", phone: "any", email: "any", skipClosed: false,
  });
  const [leads, setLeads] = useState<Lead[]>([]);
  const [activeBatch, setActiveBatch] = useState<LeadBatch | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [problem, setProblem] = useState("");
  const [historyLoading, setHistoryLoading] = useState(true);
  const [apifyConfigured, setApifyConfigured] = useState(false);
  const [pocketBaseConfigured, setPocketBaseConfigured] = useState(false);
  const [isDevelopmentEnvironment, setIsDevelopmentEnvironment] = useState(false);
  const [currentUser, setCurrentUser] = useState<{ id: string; email: string; credits: number } | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authProblem, setAuthProblem] = useState("");
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const [activeTableAction, setActiveTableAction] = useState<TableAction | null>(null);
  const [analysisBusy, setAnalysisBusy] = useState<TableAction | null>(null);
  const [analysisRowBusyId, setAnalysisRowBusyId] = useState("");
  const [analysisDiagnostics, setAnalysisDiagnostics] = useState<AnalysisDiagnostic[]>([]);
  const [analysisDiagnosticsOpen, setAnalysisDiagnosticsOpen] = useState(false);
  const [analysisScope, setAnalysisScope] = useState<AnalysisScope>("batch");
  const [analysisLeadId, setAnalysisLeadId] = useState("");
  const [selectedSocialNetworks, setSelectedSocialNetworks] = useState<SocialNetwork[]>(socialNetworkOptions.map(({ id }) => id));
  const [painFocus, setPainFocus] = useState("");
  const [analysisDialog, setAnalysisDialog] = useState<{ leadId: string; action: TableAction } | null>(null);
  const [cellDetail, setCellDetail] = useState<{ leadId: string; title: string; value: string } | null>(null);
  const cellDetailAnchorRef = useRef<HTMLTableCellElement>(null);
  const lastAnalysisTapRef = useRef<{ key: string; at: number } | null>(null);
  const analysisPopoverRef = useRef<HTMLElement>(null);
  const tableActionCardRef = useRef<HTMLDivElement>(null);
  const batchSizes = isDevelopmentEnvironment ? [1, 2, ...productionBatchSizes] : productionBatchSizes;
  const selectedPainLead = leads.find((lead) => lead.id === analysisLeadId) ?? leads[0];
  const painLeadCount = analysisScope === "row"
    ? Number(Boolean(selectedPainLead?.maps_url && /^https?:\/\//i.test(selectedPainLead.maps_url)))
    : leads.filter((lead) => Boolean(lead.maps_url && /^https?:\/\//i.test(lead.maps_url))).length;
  const numberLocale = locale === "es" ? "es-AR" : "en-US";
  const googleAuthError = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("authError") === "google"
    ? "No se pudo completar el acceso con Google. Intenta nuevamente."
    : "";
  const painCreditCost = (painLeadCount * 0.5).toLocaleString(numberLocale, { maximumFractionDigits: 1 });

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/geography?level=countries", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("No se pudo cargar la lista de países.");
        const options = await response.json() as GeographyOption[];
        setCountries(options);
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setGeographyError("No se pudo cargar la lista de países. Recargá la página para intentar de nuevo.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setGeographyLoading((current) => ({ ...current, countries: false }));
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!countryCode) return;
    const controller = new AbortController();
    fetch(`/api/geography?level=provinces&country=${encodeURIComponent(countryCode)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("No se pudieron cargar las provincias.");
        setProvinces(await response.json() as GeographyOption[]);
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setGeographyError("No se pudo cargar la lista de provincias.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setGeographyLoading((current) => ({ ...current, provinces: false }));
      });
    return () => controller.abort();
  }, [countryCode]);

  useEffect(() => {
    if (!countryCode || !provinceCode) return;
    const controller = new AbortController();
    fetch(`/api/geography?level=districts&country=${encodeURIComponent(countryCode)}&province=${encodeURIComponent(provinceCode)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("No se pudieron cargar las localidades.");
        setDistricts(await response.json() as GeographyOption[]);
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setGeographyError("No se pudo cargar la lista de localidades.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setGeographyLoading((current) => ({ ...current, districts: false }));
      });
    return () => controller.abort();
  }, [countryCode, provinceCode]);
  const tableColumns: TableColumn[] = useMemo(() => getLeadColumns(
    leads,
    analysisBusy === "enrichment" ? selectedSocialNetworks : [],
    isDevelopmentEnvironment,
  ).flatMap((column) => column.key === "phone" ? [column, { key: "whatsapp", label: "WhatsApp" }] : [column]), [
    leads,
    analysisBusy,
    selectedSocialNetworks,
    isDevelopmentEnvironment,
  ]);

  function openCellDetail(
    event: MouseEvent<HTMLTableCellElement> | ReactKeyboardEvent<HTMLTableCellElement>,
    lead: Lead,
    column: TableColumn,
    value: string,
  ) {
    if (event.target instanceof Element && event.target.closest("a,button,input,textarea,select,[role='dialog']")) return;
    if ("key" in event && event.key !== "Enter" && event.key !== " ") return;
    if ("key" in event) event.preventDefault();
    cellDetailAnchorRef.current = event.currentTarget;
    setCellDetail({ leadId: lead.id, title: column.label, value: value || "Sin dato" });
  }

  function openLinkedCellDetail(event: MouseEvent<HTMLAnchorElement>, lead: Lead, column: TableColumn, value: string) {
    event.preventDefault();
    cellDetailAnchorRef.current = event.currentTarget.closest("td");
    setCellDetail({ leadId: lead.id, title: column.label, value: value || "Sin dato" });
  }

  function cellDetailProps(lead: Lead, column: TableColumn, value: string) {
    return {
      tabIndex: 0,
      "aria-haspopup": "dialog" as const,
      "aria-label": `Ver detalle de ${column.label} para ${lead.name}`,
      onClick: (event: MouseEvent<HTMLTableCellElement>) => openCellDetail(event, lead, column, value),
      onKeyDown: (event: ReactKeyboardEvent<HTMLTableCellElement>) => openCellDetail(event, lead, column, value),
    };
  }

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
        if (authPayload.user.role === "owner") {
          window.location.replace(window.location.pathname.startsWith("/en/") ? "/en/owner" : "/owner");
          return;
        }
        setCurrentUser({
          ...authPayload.user,
          credits: typeof authPayload.user.credits === "number" && Number.isFinite(authPayload.user.credits) && authPayload.user.credits >= 0
            ? authPayload.user.credits
            : 0,
        });
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

  useEffect(() => {
    if (!profileMenuOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !profileMenuRef.current?.contains(event.target)) {
        setProfileMenuOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setProfileMenuOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [profileMenuOpen]);

  useEffect(() => {
    if (activeTableAction) tableActionCardRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [activeTableAction]);

  useEffect(() => {
    if (!analysisDialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    analysisPopoverRef.current?.querySelector<HTMLElement>("button")?.focus();
    const handleDialogKeys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAnalysisDialog(null);
        return;
      }
      if (event.key !== "Tab" || !analysisPopoverRef.current) return;
      const focusable = [...analysisPopoverRef.current.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)')];
      if (!focusable.length) return;
      if (event.shiftKey && document.activeElement === focusable[0]) {
        event.preventDefault();
        focusable[focusable.length - 1].focus();
      } else if (!event.shiftKey && document.activeElement === focusable[focusable.length - 1]) {
        event.preventDefault();
        focusable[0].focus();
      }
    };
    document.addEventListener("keydown", handleDialogKeys);
    return () => {
      document.removeEventListener("keydown", handleDialogKeys);
      previousFocus?.focus();
    };
  }, [analysisDialog]);

  async function signOut() {
    setProfileMenuOpen(false);
    await fetch("/api/auth/logout", { method: "POST" });
    setCurrentUser(null);
    setLeads([]);
    setActiveBatch(null);
  }

  async function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const keywords = parseKeywords(String(formData.get("keywords") ?? ""));
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
    setNotice("Buscando negocios y guardando el lote");

    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keywords, country, province, district, count,
          filters: {
            ...filters,
            minReviews: filters.minReviews === "" ? undefined : Number(filters.minReviews),
            minRating: filters.minRating === "" ? undefined : Number(filters.minRating),
          },
        }),
      });
      const payload = await response.json();
      if (typeof payload.credits === "number") {
        setCurrentUser((user) => user ? { ...user, credits: payload.credits } : user);
      }
      if (!response.ok) throw new Error(payload.error || "No se pudo completar la búsqueda.");

      const newBatch = ((await fetch("/api/batches", { cache: "no-store" }).then((result) => result.json())).batches as LeadBatch[])
        .find((batch) => batch.id === payload.batchId);
      setLeads(payload.leads as Lead[]);
      if (newBatch) {
        setActiveBatch(newBatch);
      }
      setNotice(`${payload.leads.length} leads guardados en el lote.`);
      if (payload.shortfall) {
        setProblem(`No se encontraron suficientes Leads. Cambia ubicacíon o Keywords!${payload.warning ? ` ${payload.warning}` : ""}`);
      } else if (payload.warning) {
        setProblem(`El lote quedó parcial. ${payload.warning}`);
      }
    } catch (error) {
      setNotice("");
      setProblem(error instanceof Error ? error.message : "No se pudo completar la búsqueda.");
    } finally {
      setBusy(false);
    }
  }

  async function startAnalysis(action: TableAction, rowLeadId?: string) {
    if (!activeBatch || analysisBusy || (!rowLeadId && analysisScope === "row" && !analysisLeadId && !leads[0])) return;
    const targetLeadId = rowLeadId || (analysisScope === "row"
      ? (leads.some((lead) => lead.id === analysisLeadId) ? analysisLeadId : leads[0]?.id)
      : undefined);
    const targetLead = targetLeadId ? leads.find((lead) => lead.id === targetLeadId) : null;
    if ((rowLeadId || analysisScope === "row") && !targetLead) return;
    setAnalysisBusy(action);
    setAnalysisRowBusyId(rowLeadId || (analysisScope === "row" ? targetLeadId || "" : ""));
    setProblem("");
    setAnalysisDiagnostics([]);
    setAnalysisDiagnosticsOpen(false);
    setNotice(action === "pain_points" ? "Buscando reseñas negativas y analizando dolores…" : "OpenRouter revisando las redes seleccionadas…");
    try {
      const response = await fetch("/api/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batchId: activeBatch.id,
          action,
          ...(targetLeadId ? { leadId: targetLeadId } : {}),
          ...(action === "enrichment" ? { socialNetworks: selectedSocialNetworks } : {}),
          ...(action === "pain_points" ? { focus: painFocus.trim() } : {}),
        }),
      });
      const payload = await response.json();
      if (typeof payload.credits === "number") {
        setCurrentUser((user) => user ? { ...user, credits: payload.credits } : user);
      }
      if (!response.ok) throw new Error(payload.error || "No se pudo completar el análisis.");
      setLeads(payload.leads as Lead[]);
      const diagnostics = Array.isArray(payload.diagnostics) ? payload.diagnostics as AnalysisDiagnostic[] : [];
      setAnalysisDiagnostics(diagnostics);
      if (diagnostics.length > 0) setAnalysisDiagnosticsOpen(true);
      if (action === "pain_points") {
        setNotice(`${payload.analyzedCount} ${payload.analyzedCount === 1 ? "lead analizado" : "leads analizados"}; ${payload.findingCount || 0} con dolores detectados.`);
      } else {
        setNotice(`${payload.analyzedCount} leads enriquecidos.`);
      }
      if (payload.noEvidenceCount > 0 || payload.failedCount > 0) {
        const issues: string[] = [];
        if (payload.noEvidenceCount > 0) {
          issues.push(action === "pain_points"
            ? `${payload.noEvidenceCount} sin ficha de Maps ni reseñas guardadas`
            : `${payload.noEvidenceCount} sin datos guardados para enriquecer`);
        }
        const failureMessages = Array.isArray(payload.failures)
          ? [...new Set(payload.failures.map((failure: { message?: unknown }) => typeof failure?.message === "string" ? failure.message : "" ).filter(Boolean))]
          : [];
        if (payload.failedCount > 0) {
          issues.push(`${payload.failedCount} con error${failureMessages.length ? `: ${failureMessages.join("; ")}` : ""}`);
        }
        setProblem(`${issues.join(". ")}.`);
      }
    } catch (error) {
      setNotice("");
      setProblem(error instanceof Error ? error.message : "No se pudo completar el análisis.");
    } finally {
      setAnalysisBusy(null);
      setAnalysisRowBusyId("");
    }
  }

  function handleAnalysisCellPointer(lead: Lead, action: TableAction, pointerType: string, now: number) {
    if (pointerType === "mouse") return;
    const key = `${lead.id}:${action}`;
    const lastTap = lastAnalysisTapRef.current;
    if (lastTap?.key === key && now - lastTap.at < 650) {
      lastAnalysisTapRef.current = null;
      setAnalysisDialog({ leadId: lead.id, action });
      return;
    }
    lastAnalysisTapRef.current = { key, at: now };
  }

  if (authLoading) return <main className="app-shell auth-loading" aria-live="polite">{t("t_50aa6fdfd6")}</main>;
  if (!currentUser) return <AuthForm initialError={authProblem || googleAuthError} initialMode={typeof window !== "undefined" && new URLSearchParams(window.location.search).get("signup") === "1" ? "register" : "login"} onAuthenticated={() => window.location.reload()} />;

  return (
    <main className="app-shell">
      <nav className="topbar" aria-label="Navegación principal">
        <BrandLogo /><LanguageSwitcher />
        <div className="topbar-account">
          <Link className="credits-pill" href="/pricing" aria-label={`${currentUser.credits} créditos disponibles. Ver planes`} title="Ver planes y sumar créditos">
            <Stars className="credits-icon" size={17} strokeWidth={1.9} aria-hidden="true" />
            <span className="credits-value"><strong>{currentUser.credits.toLocaleString(numberLocale)}</strong><small>{t("t_bcc0da40b3")}</small></span>
            <span className="credits-add-sign" aria-hidden="true">+</span>
          </Link>
          <div className="profile-menu-wrap" ref={profileMenuRef}>
            <button
              type="button"
              className="profile-pill"
              aria-expanded={profileMenuOpen}
              aria-haspopup="menu"
              aria-controls="profile-menu"
              onClick={() => setProfileMenuOpen((open) => !open)}
            >
              <span className="connection-dot" aria-hidden="true" />
              <span className="profile-email">{currentUser.email}</span>
              <ChevronDown className={`profile-chevron${profileMenuOpen ? " is-open" : ""}`} size={15} strokeWidth={1.8} aria-hidden="true" />
            </button>
            {profileMenuOpen && (
              <div className="profile-menu" id="profile-menu" role="menu" aria-label="Menú de cuenta">
                <Link href="/historial" role="menuitem" onClick={() => setProfileMenuOpen(false)}>
                  <History className="menu-icon" size={18} strokeWidth={1.8} aria-hidden="true" />
                  <span>{t("t_302027905c")}</span>
                </Link>
                <div className="profile-menu-divider" />
                <button type="button" className="signout-menu-item" role="menuitem" onClick={() => void signOut()}>
                  <LogOut className="menu-icon signout-icon" size={18} strokeWidth={1.8} aria-hidden="true" />
                  <span>{t("t_f394d0254e")}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      <div className="workspace">
        <form className="search-panel" onSubmit={submitSearch}>
          <div className="panel-heading">
            <div>
              <h2>{t("t_23be92b60b")}</h2>
              <p>{t("t_2882d7230e")}</p>
            </div>
            <span className="required-note"><span aria-hidden="true">*</span> {t("t_f128ad0f39")}</span>
          </div>

          <div className="form-grid">
            <KeywordsField />

            <div className="field geography-field">
              <span className="field-label">{t("t_ae0ddfcae9")} <span className="required-mark">*</span></span>
              <div className="location-grid">
                <label>
                  <span className="sr-only">{t("t_c4a5d0602b")}</span>
                  <span className="select-control"><select
                    value={countryCode}
                    onChange={(event) => {
                      const nextCountryCode = event.target.value;
                      setCountryCode(nextCountryCode);
                      setCountry(countries.find((option) => option.code === nextCountryCode)?.name ?? "");
                      setProvinceCode("");
                      setProvince("");
                      setDistrict("");
                      setProvinces([]);
                      setDistricts([]);
                      setGeographyLoading((current) => ({ ...current, provinces: Boolean(nextCountryCode), districts: false }));
                      setGeographyError("");
                    }}
                    required
                    aria-label="País obligatorio"
                    disabled={geographyLoading.countries || countries.length === 0}
                  >
                    <option value="">{geographyLoading.countries ? "Cargando países" : "País (obligatorio)"}</option>
                    {countries.map((option) => <option value={option.code} key={option.code}>{option.name}</option>)}
                  </select><span className="select-chevron" aria-hidden="true" /></span>
                </label>
                <label>
                  <span className="sr-only">{t("t_89f015b081")}</span>
                  <span className="select-control"><select
                    value={provinceCode}
                    onChange={(event) => {
                      const nextProvinceCode = event.target.value;
                      setProvinceCode(nextProvinceCode);
                      setProvince(provinces.find((option) => option.code === nextProvinceCode)?.name ?? "");
                      setDistrict("");
                      setDistricts([]);
                      setGeographyLoading((current) => ({ ...current, districts: Boolean(nextProvinceCode) }));
                      setGeographyError("");
                    }}
                    aria-label="Provincia o estado opcional"
                    disabled={!countryCode || geographyLoading.provinces || provinces.length === 0}
                  >
                    <option value="">{geographyLoading.provinces ? "Cargando provincias" : "Provincia / estado (opcional)"}</option>
                    {provinces.map((option) => <option value={option.code} key={option.code}>{option.name}</option>)}
                  </select><span className="select-chevron" aria-hidden="true" /></span>
                </label>
                <label>
                  <span className="sr-only">{t("t_c6e0bdca3e")}</span>
                  <span className="select-control"><select
                    value={district}
                    onChange={(event) => setDistrict(event.target.value)}
                    aria-label="Ciudad o localidad opcional"
                    disabled={!provinceCode || geographyLoading.districts || districts.length === 0}
                  >
                    <option value="">{geographyLoading.districts ? "Cargando localidades" : "Ciudad / localidad (opcional)"}</option>
                    {districts.map((option) => <option value={option.name} key={option.code}>{option.name}</option>)}
                  </select><span className="select-chevron" aria-hidden="true" /></span>
                </label>
              </div>
              <span className="field-help">{t("t_08a1c28ca4")}</span>
              {geographyError && <span className="field-error" role="alert">{geographyError}</span>}
            </div>

            <fieldset className="field batch-field">
              <legend className="field-label">{t("t_cad2c8e692")}{isDevelopmentEnvironment && <span className="test-mode-label">{t("t_be14c472da")}</span>}</legend>
              <div className="batch-options" role="radiogroup" aria-label="Cantidad de leads por lote">
                {batchSizes.map((size) => (
                  <label className={`batch-option${count === size ? " is-selected" : ""}`} key={size}>
                    <input type="radio" name="batch-size" value={size} checked={count === size} onChange={() => setCount(size)} />
                    <span>{size}</span>
                  </label>
                ))}
              </div>
              <p className="batch-credit-cost" aria-live="polite">
                <Stars size={16} aria-hidden="true" />
                <strong>{(count * 2).toLocaleString(numberLocale)} {t("t_66376a612c")}</strong>
              </p>
            </fieldset>

            <details className="filter-panel">
              <summary>{t("t_dc3b882450")}</summary>
              <div className="filter-grid">
                <label className="field">
                  <span className="field-label">{t("t_44fdec749a")}</span>
                  <span className="select-control"><select value={filters.minReviews} onChange={(event) => setFilters((current) => ({ ...current, minReviews: event.target.value }))}>
                    <option value="">{t("t_1aa3b744db")}</option><option value="10">{t("t_3e9d0406a7")}</option><option value="50">{t("t_7f0504184b")}</option><option value="100">{t("t_39fad5c7a6")}</option><option value="500">{t("t_9c2c993477")}</option>
                  </select><span className="select-chevron" aria-hidden="true" /></span>
                </label>
                <label className="field">
                  <span className="field-label">{t("t_c323da7d69")}</span>
                  <span className="select-control"><select value={filters.minRating} onChange={(event) => setFilters((current) => ({ ...current, minRating: event.target.value }))}>
                    <option value="">{t("t_1aa3b744db")}</option><option value="3">{t("t_610341e9f3")}</option><option value="4">{t("t_aba4c147b4")}</option><option value="4.5">{t("t_d03277dee0")}</option>
                  </select><span className="select-chevron" aria-hidden="true" /></span>
                </label>
                <label className="field">
                  <span className="field-label">{t("t_e3fd0b8e08")}</span>
                  <span className="select-control"><select value={filters.website} onChange={(event) => setFilters((current) => ({ ...current, website: event.target.value as FilterChoice }))}>
                    <option value="any">{t("t_408317ffa3")}</option><option value="with">{t("t_139ef9d2c1")}</option><option value="without">{t("t_fcfe9b7823")}</option>
                  </select><span className="select-chevron" aria-hidden="true" /></span>
                </label>
                <label className="field">
                  <span className="field-label">{t("t_84add5b295")}</span>
                  <span className="select-control"><select value={filters.email} onChange={(event) => setFilters((current) => ({ ...current, email: event.target.value as FilterChoice }))}>
                    <option value="any">{t("t_268e9ea19f")}</option><option value="with">{t("t_3014233e51")}</option><option value="without">{t("t_b1f7ce3fe3")}</option>
                  </select><span className="select-chevron" aria-hidden="true" /></span>
                </label>
                <label className="field">
                  <span className="field-label">{t("t_99af3763e0")}</span>
                  <span className="select-control"><select value={filters.phone} onChange={(event) => setFilters((current) => ({ ...current, phone: event.target.value as FilterChoice }))}>
                    <option value="any">{t("t_9d7025a384")}</option><option value="with">{t("t_86fc9079fb")}</option><option value="without">{t("t_5a107669e1")}</option>
                  </select><span className="select-chevron" aria-hidden="true" /></span>
                </label>
                <label className="filter-checkbox">
                  <input type="checkbox" checked={filters.skipClosed} onChange={(event) => setFilters((current) => ({ ...current, skipClosed: event.target.checked }))} />
                  <span>{t("t_d969b6207f")}</span>
                </label>
              </div>
              {filters.email === "without" && <p className="field-help filter-note">{t("t_c7d6c48ff2")}</p>}
            </details>

            <div className="search-action">
              <button className="primary-button" type="submit" disabled={busy || !apifyConfigured || !pocketBaseConfigured || !country.trim()}>
                {busy ? <><span className="button-spinner" aria-hidden="true" /> {t("t_b6d453ae3d")}</> : "Buscar leads"}
              </button>
              <span className="action-caption">{!apifyConfigured ? "Falta configurar APIFY_TOKEN en el servidor" : !pocketBaseConfigured ? "Falta conectar PocketBase" : `Máximo ${count} leads por lote`}</span>
            </div>
          </div>
          <p className="cost-note">{t("t_617db756b7")}</p>
        </form>

        {(problem || notice) && (
          <div className={`status-message${problem ? " is-error" : " is-success"}`} role={problem ? "alert" : "status"}>
            {problem
              ? <CircleAlert className="status-icon" size={19} strokeWidth={2} aria-hidden="true" />
              : <CircleCheck className="status-icon" size={19} strokeWidth={2} aria-hidden="true" />}
            <span>{problem || notice}</span>
            {isDevelopmentEnvironment && analysisDiagnostics.length > 0 && (
              <button type="button" className="diagnostic-open-button" onClick={() => setAnalysisDiagnosticsOpen(true)}>
                <Bug size={14} aria-hidden="true" /> {t("t_9c2aa37466")} </button>
            )}
            {problem && <button type="button" className="dismiss-button" onClick={() => setProblem("")}>{t("t_4b0816bbd5")}</button>}
          </div>
        )}

        <section className="results-section" id="history-section" aria-labelledby="results-title">
          <div className="results-heading">
            <div>
              <div className="results-title-row">
                <h2 id="results-title">{t("t_ecfdbebecc")}</h2>
                <span className="result-count">{leads.length}</span>
              </div>
              {activeBatch && <p className="active-location">{placeLabel(activeBatch)} <span>·</span> {activeBatch.keywords.join(", ")}</p>}
            </div>
            <button className="export-button" type="button" onClick={() => downloadCsv(leads, activeBatch, isDevelopmentEnvironment)} disabled={leads.length === 0}>
              {t("t_8b9c2038c4")} </button>
          </div>

          {activeTableAction && (
            <div className="table-action-card" id="table-action-card" ref={tableActionCardRef} role="region" aria-labelledby="table-action-title">
              <div className="table-action-card-main">
                <span className="ai-sparkle table-action-card-sparkle" aria-hidden="true" />
                <div>
                  <h3 id="table-action-title">{tableActions[activeTableAction].title}</h3>
                  <p>{tableActions[activeTableAction].description}</p>
                  {activeTableAction === "pain_points" && <small>{t("t_6e30ea45d9")}</small>}
                </div>
              </div>
              <div className="table-action-controls">
                {activeTableAction === "pain_points" && (
                  <label className="analysis-focus-field">
                    <span>{t("t_ea9c745083")}</span>
                    <input
                      type="text"
                      value={painFocus}
                      maxLength={300}
                      placeholder="Ej.: dolores que podría resolver un software"
                      onChange={(event) => setPainFocus(event.target.value)}
                      disabled={Boolean(analysisBusy)}
                    />
                    <small>{t("t_0ab986078b")}</small>
                  </label>
                )}
                <label className="analysis-select-field">
                  <span>{t("t_c3179d7124")}</span>
                  <select value={analysisScope} onChange={(event) => setAnalysisScope(event.target.value as AnalysisScope)} disabled={Boolean(analysisBusy)}>
                    <option value="batch">{t("t_024b3972a0")}{leads.length})</option>
                    <option value="row">{t("t_2cb5736399")}</option>
                  </select>
                </label>
                {analysisScope === "row" && (
                  <label className="analysis-select-field analysis-lead-select">
                    <span>{t("t_c6f71d85ae")}</span>
                    <select value={leads.some((lead) => lead.id === analysisLeadId) ? analysisLeadId : leads[0]?.id || ""} onChange={(event) => setAnalysisLeadId(event.target.value)} disabled={Boolean(analysisBusy) || leads.length === 0}>
                      {leads.map((lead) => <option key={lead.id} value={lead.id}>{lead.name}</option>)}
                    </select>
                  </label>
                )}
                {isDevelopmentEnvironment && activeTableAction === "enrichment" && (
                  <fieldset className="social-network-picker">
                    <legend>{t("t_c9245609b2")}</legend>
                    <div className="social-network-options">
                      {socialNetworkOptions.map(({ id, label }) => (
                        <label key={id} className="social-network-option">
                          <input
                            type="checkbox"
                            checked={selectedSocialNetworks.includes(id)}
                            disabled={Boolean(analysisBusy)}
                            onChange={(event) => setSelectedSocialNetworks((current) => event.target.checked
                              ? [...current, id]
                              : current.filter((network) => network !== id))}
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                    <small>{t("t_102295ee1f")}</small>
                  </fieldset>
                )}
              </div>
              <button className="primary-button table-action-start" type="button" disabled={!activeBatch || leads.length === 0 || Boolean(analysisBusy) || (analysisScope === "row" && !leads.length)} onClick={() => void startAnalysis(activeTableAction)}>
                {analysisBusy === activeTableAction ? <><LoaderCircle className="button-spinner-icon" aria-hidden="true" /> {t("t_740ecf6aec")}</> : activeTableAction === "pain_points" ? `Analizar dolores \u00b7 ${painCreditCost} cr\u00e9ditos` : tableActions[activeTableAction].cta}
              </button>
              <button className="table-action-close" type="button" aria-label="Cerrar tarjeta" onClick={() => setActiveTableAction(null)}><X size={18} aria-hidden="true" /></button>
            </div>
          )}

          <p className="table-scroll-hint">{t("t_00c94041d2")}</p>
          <div className="table-frame" tabIndex={0} aria-label="Resultados de leads, desplazables horizontal y verticalmente; muestra hasta 25 filas a la vez">
            <table>
              <thead>
                <tr>{tableColumns.map((column) => {
                  const action: TableAction | null = column.key === "pain_points" ? "pain_points" : column.key === "enrichment" ? "enrichment" : null;
                  return (
                    <th key={column.key} scope="col">
                      {action ? (
                        <button
                          className="table-action-header"
                          type="button"
                          title={tableActions[action].title}
                          aria-label={tableActions[action].title}
                          aria-expanded={activeTableAction === action}
                          aria-controls="table-action-card"
                          onClick={() => setActiveTableAction((current) => {
                            if (current === action) return null;
                            setAnalysisScope("batch");
                            setAnalysisLeadId(leads[0]?.id ?? "");
                            return action;
                          })}
                        >
                          <span className="ai-sparkle" aria-hidden="true" />
                          <span>{column.label}</span>
                        </button>
                      ) : column.label}
                    </th>
                  );
                })}</tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <tr key={lead.id}>
                    {tableColumns.map((column) => {
                      if (column.key === "whatsapp") {
                        return <td key={column.key} {...cellDetailProps(lead, column, lead.phone || "Sin dato")}><WhatsAppContact phone={lead.phone} /></td>;
                      }
                      const reviewMatch = /^review_([1-5])$/.exec(column.key);
                      if (reviewMatch) {
                        const review = lead.source_reviews?.[Number(reviewMatch[1]) - 1];
                        const reviewDetail = review
                          ? [
                              review.rating === null ? "" : `Calificación: ${review.rating}/5`,
                              review.published_at ? `${locale === "es" ? "Fecha" : "Date"}: ${reviewDate(review.published_at, locale)}` : "",
                              review.text,
                              review.owner_response ? `Respuesta del negocio: ${review.owner_response}` : "",
                            ].filter(Boolean).join("\n\n")
                          : "Sin reseña";
                        return <td className="lead-review-cell" key={column.key} title={review?.text || ""} {...cellDetailProps(lead, column, reviewDetail)}>
                          {review && <>
                            <span className="lead-review-meta">{[review.rating === null ? "" : `${review.rating}/5`, review.published_at ? reviewDate(review.published_at, locale) : ""].filter(Boolean).join(" · ")}</span>
                            <span className="lead-review-copy">{review.text}</span>
                            {review.owner_response && <span className="lead-review-response">{t("t_852c5e0706")} {review.owner_response}</span>}
                          </>}
                        </td>;
                      }
                      const value = getLeadColumnValue(lead, column.key);
                      const socialNetworkMatch = /^social_(facebook|instagram|youtube|linkedin)$/.exec(column.key);
                      if (socialNetworkMatch) {
                        const network = socialNetworkMatch[1] as SocialNetwork;
                        const networkWasSelected = lead.enrichment_detail?.social_networks?.includes(network);
                        return <td key={column.key} title={String(value || "")} {...cellDetailProps(lead, column, String(value || (networkWasSelected ? "Sin dato" : "Sin perfil disponible")))}>{value
                          ? <a className="table-link" href={String(value)} target="_blank" rel="noreferrer" onClick={(event) => openLinkedCellDetail(event, lead, column, String(value))}>{t("t_3afc60274c")}</a>
                          : networkWasSelected ? <span className="analysis-cell-empty is-no-data">{t("t_29b2157143")}</span> : ""}</td>;
                      }
                      if (column.key === "pain_points" || column.key === "enrichment") {
                        const action: TableAction = column.key;
                        const detail = analysisDetail(action === "pain_points" ? lead.pain_points_detail : lead.enrichment_detail);
                        const content = action === "pain_points"
                          ? (detail?.findings.map((finding) => finding.title.trim()).filter(Boolean).join("; ") || "")
                          : String(value || "");
                        const fullAnalysis = action === "pain_points"
                          ? detail?.findings.map((finding) => [finding.title, finding.detail, ...finding.sources.map((source) => `${source.label}: ${source.text}${source.url ? ` (${source.url})` : ""}`)].filter(Boolean).join("\n")).join("\n\n") || content
                          : [detail?.summary, content].filter((part, index, parts) => Boolean(part) && parts.indexOf(part) === index).join("\n\n");
                        const noData = !content && Boolean(detail?.status);
                        const needsAnalysis = !content && !noData;
                        const cellText = content || (action === "pain_points" && detail?.status === "completed" ? "Sin dolores" : noData ? "Sin dato" : "Sin analizar");
                        return (
                          <td key={column.key} className="analysis-cell" {...cellDetailProps(lead, column, fullAnalysis || cellText)}>
                            <button
                              className={`analysis-cell-trigger${noData ? " is-no-data" : ""}`}
                              type="button"
                              disabled={needsAnalysis && Boolean(analysisBusy)}
                              onClick={needsAnalysis ? () => void startAnalysis(action, lead.id) : (event) => {
                                cellDetailAnchorRef.current = event.currentTarget.closest("td");
                                setCellDetail({ leadId: lead.id, title: column.label, value: fullAnalysis || cellText });
                              }}
                              onPointerUp={needsAnalysis ? undefined : (event) => handleAnalysisCellPointer(lead, action, event.pointerType, event.timeStamp)}
                              onDoubleClick={needsAnalysis ? undefined : () => setAnalysisDialog({ leadId: lead.id, action })}
                              onKeyDown={needsAnalysis ? undefined : (event) => { if (event.key === "Enter" || event.key === " ") setAnalysisDialog({ leadId: lead.id, action }); }}
                              title={needsAnalysis ? "Analizar este lead" : "Doble clic o doble toque para abrir el análisis"}
                            >
                              {analysisBusy === action && needsAnalysis && (!analysisRowBusyId || analysisRowBusyId === lead.id) ? "Analizando" : cellText}
                            </button>
                            {detail && <span className="analysis-source-count">{detail.findings.length} {t("t_a1c92c8aa4")}</span>}
                          </td>
                        );
                      }
                      if (column.key === "email" && !value) {
                        const enrichmentAttempted = Boolean(lead.enrichment_detail?.status || lead.enrichment?.trim());
                        return <td key={column.key} {...cellDetailProps(lead, column, enrichmentAttempted ? "Sin dato" : "Todavía no se enriqueció el mail.")}>{enrichmentAttempted
                          ? <span className="analysis-cell-empty is-no-data">{t("t_29b2157143")}</span>
                          : <button className="analysis-cell-trigger is-enrich" type="button" disabled={Boolean(analysisBusy)} onClick={() => void startAnalysis("enrichment", lead.id)} aria-label={`Enriquecer mail de ${lead.name}`}>{analysisBusy === "enrichment" && (!analysisRowBusyId || analysisRowBusyId === lead.id) ? "Enriqueciendo" : "Enriquecer"}</button>}</td>;
                      }
                      const isLink = (column.key === "maps_url" || column.key === "website") && Boolean(value);
                      const ratingColumn = /^rating_[1-5]$/.test(column.key);
                      return (
                        <td key={column.key} className={ratingColumn ? "rating-breakdown-cell" : undefined} {...cellDetailProps(lead, column, value == null || value === "" ? "Sin dato" : String(value))}>
                          {isLink ? <a className="table-link" href={String(value)} target="_blank" rel="noreferrer" title={String(value)} onClick={(event) => openLinkedCellDetail(event, lead, column, String(value))}>{column.key === "maps_url" ? "Google Maps" : String(value)}</a> : value == null ? "" : String(value)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {leads.length === 0 && !busy && (
                  <tr><td className="empty-cell" colSpan={tableColumns.length}>
                    <strong>{historyLoading ? "Conectando con tu historial" : "Todavía no hay leads"}</strong>
                    <span>{historyLoading ? "" : "Completá una keyword y la zona para generar el primer lote."}</span>
                  </td></tr>
                )}
                {busy && Array.from({ length: Math.min(count, 5) }, (_, index) => (
                  <tr className="skeleton-row" key={`skeleton-${index}`} aria-hidden="true">
                    {tableColumns.map((column) => <td key={column.key}><span /></td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-footer"><span>{t("t_9abf183dfd")}</span><span>{leads.length} {leads.length === 1 ? "registro" : "registros"}</span></div>
        </section>

        <CellDetailsPopover
          open={Boolean(cellDetail && leads.some((lead) => lead.id === cellDetail.leadId))}
          anchorRef={cellDetailAnchorRef}
          title={cellDetail?.title || "Detalle del lead"}
          leadName={leads.find((lead) => lead.id === cellDetail?.leadId)?.name || ""}
          value={cellDetail?.value || ""}
          onClose={() => setCellDetail(null)}
        />

        {analysisDialog && (() => {
          const { action } = analysisDialog;
          const lead = leads.find((item) => item.id === analysisDialog.leadId);
          if (!lead) return null;
          const detail = analysisDetail(action === "pain_points" ? lead.pain_points_detail : lead.enrichment_detail);
          const savedSummary = action === "enrichment" ? lead.enrichment : "";
          return (
            <div className="analysis-popover-backdrop" onClick={() => setAnalysisDialog(null)}>
              <section ref={analysisPopoverRef} className="analysis-popover" role="dialog" aria-modal="true" aria-labelledby="analysis-popover-title" onClick={(event) => event.stopPropagation()}>
                <button className="analysis-popover-close" type="button" aria-label="Cerrar análisis" onClick={() => setAnalysisDialog(null)}><X size={18} aria-hidden="true" /></button>
                <p className="analysis-popover-lead">{lead.name}</p>
                <h2 id="analysis-popover-title">{tableActions[action].title}</h2>
                {detail ? (
                  <>
                    {action === "enrichment" && detail.summary && <p className="analysis-popover-summary">{detail.summary}</p>}
                    {action === "pain_points" && detail.findings.length === 0 && <p className="analysis-popover-empty">{t("t_63b75cd9df")}</p>}
                    {detail.findings.length > 0 && <ol className="analysis-findings">
                      {detail.findings.map((finding, index) => (
                        <li key={`${finding.title}-${index}`}>
                          <strong>{finding.title}</strong>
                          <p>{finding.detail}</p>
                          <div className="analysis-evidence-list">
                            {finding.sources.map((source) => (
                              <a key={source.id} href={source.url || lead.maps_url} target="_blank" rel="noreferrer" className="analysis-evidence-link">
                                <span>{source.label}</span><ExternalLink size={13} aria-hidden="true" />
                                <small>{source.text}</small>
                              </a>
                            ))}
                          </div>
                        </li>
                      ))}
                    </ol>}
                    {detail.limitations && <p className="analysis-limitations">{detail.limitations}</p>}
                  </>
                ) : savedSummary ? (
                  <>
                    <p className="analysis-popover-summary">{savedSummary}</p>
                    <p className="analysis-limitations">{t("t_733aae66e6")}</p>
                  </>
                ) : (
                  <p className="analysis-popover-empty">{t("t_1b50c2bb60")}</p>
                )}
              </section>
            </div>
          );
        })()}

        {isDevelopmentEnvironment && analysisDiagnosticsOpen && (
          <aside className="analysis-debug-panel" aria-label="Depuración del análisis">
            <div className="analysis-debug-heading">
              <div>
                <p>{t("t_09b2e55d91")}</p>
                <h2>{t("t_5c39e5458c")}</h2>
              </div>
              <button type="button" aria-label="Cerrar depuración" onClick={() => setAnalysisDiagnosticsOpen(false)}><X size={18} aria-hidden="true" /></button>
            </div>
            <div className="analysis-debug-list">
              {analysisDiagnostics.map((item) => (
                <section className="analysis-debug-item" key={item.leadId}>
                  <h3>{item.leadName}</h3>
                  <dl>
                    <div><dt>{t("t_b3a01bef14")}</dt><dd>{item.model}</dd></div>
                    <div><dt>{t("t_959d7f2622")}</dt><dd>{item.webSearchEngine}, {item.webSearchRequests} {t("t_d250383517")}</dd></div>
                    <div><dt>{t("t_dd27439f3f")}</dt><dd>{item.webFetchEngine}, {item.toolCallsExecuted} {t("t_1849d8e9fe")}</dd></div>
                    <div><dt>{t("t_bb768b8463")}</dt><dd>{item.savedReviewCount}</dd></div>
                    {item.detailsStatus && <div><dt>{t("t_bbb4f0fad7")}</dt><dd>{item.detailsStatus}</dd></div>}
                    {item.mapsUrl && <div className="analysis-debug-maps-url"><dt>{t("t_0e47fc9eda")}</dt><dd><a href={item.mapsUrl} target="_blank" rel="noreferrer">{item.mapsUrl}</a></dd></div>}
                  </dl>
                  <details>
                    <summary>{t("t_391825f195")}</summary>
                    <pre>{item.response}</pre>
                  </details>
                </section>
              ))}
            </div>
          </aside>
        )}
      </div>
      <footer className="geography-source-note">{t("t_3b98716d2b")} <a href="https://github.com/dr5hn/countries-states-cities-database" target="_blank" rel="noreferrer">{t("t_9e834f3c44")}</a>{t("t_3abfa89444")} <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noreferrer">{t("t_58848303b9")}</a>.</footer>
    </main>
  );
}
