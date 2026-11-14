"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, Fragment } from "react";
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Bug, CircleAlert, CircleCheck, ExternalLink, LoaderCircle, Sparkles, Stars, Trash2, X } from "lucide-react";
import type { IconType } from "react-icons";
import { FaFacebook, FaInstagram, FaLinkedin, FaWhatsapp, FaYoutube } from "react-icons/fa";
import { findingsForTag, painView } from "@/lib/analysis-format";
import type { AnalysisDetail, Lead, LeadBatch, LeadColumnKey, LeadColumnLabeler } from "@/lib/types";
import { getLeadColumnValue, getLeadColumns, getSocialProfileUrl } from "@/lib/types";
import { AuthForm } from "@/app/auth-form";
import { AppSidebar } from "@/app/app-sidebar";
import { ErrorReportButton } from "@/app/feedback-dialog";
import CellDetailsPopover from "@/app/cell-details-popover";
import WhatsAppContact from "@/app/whatsapp-contact";
import { Onboarding } from "@/app/onboarding/onboarding";
import { getSession, invalidateSession, peekSessionUser, setSessionCredits } from "@/lib/client/session";
import { defaultSearchFilters, SearchFiltersPanel, type SearchFilters } from "./search-filters";

const productionBatchSizes = [5, 10, 25, 50, 75, 100, 125, 150];
const PAIN_FOCUS_STORAGE_KEY = "leadta:pain-focus";
const PROFILE_SAVE_DELAY_MS = 800;
// Source of truth: the user's service_offering (/api/account/profile). localStorage is only a local cache, and the
// legacy value is migrated to the profile when the profile is empty. Memory fallback keeps typing working in private mode.
let painFocusMemory = "";
const painFocusListeners = new Set<() => void>();
function readPainFocus() {
  try { return localStorage.getItem(PAIN_FOCUS_STORAGE_KEY) ?? ""; } catch { return painFocusMemory; }
}
function setPainFocus(value: string) {
  painFocusMemory = value;
  try {
    if (value) localStorage.setItem(PAIN_FOCUS_STORAGE_KEY, value);
    else localStorage.removeItem(PAIN_FOCUS_STORAGE_KEY);
  } catch {}
  painFocusListeners.forEach((listener) => listener());
}
function subscribePainFocus(listener: () => void) {
  painFocusListeners.add(listener);
  return () => { painFocusListeners.delete(listener); };
}
type TableAction ="pain_points" | "enrichment";
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
const socialNetworkOptions: { id: SocialNetwork; label: string; Icon: IconType }[] = [
  { id: "facebook", label: "Facebook", Icon: FaFacebook },
  { id: "instagram", label: "Instagram", Icon: FaInstagram },
  { id: "youtube", label: "YouTube", Icon: FaYoutube },
  { id: "linkedin", label: "LinkedIn", Icon: FaLinkedin },
];
type TableColumn = { key: LeadColumnKey | "whatsapp" | "socials"; label: string };

// Columnas de detalle de reseñas: ocultas en la tabla salvo con "Mostrar datos completos". El CSV las conserva siempre.
type GeographyOption = { code: string; name: string };
function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function downloadCsv(leads: Lead[], batch: LeadBatch | null, label: LeadColumnLabeler, ownerResponseLabel: string) {
  const columns = getLeadColumns(leads, [], true, label);
  const header = columns.map((column) => csvCell(column.label)).join(",");
  const rows = leads.map((lead) => columns.map((column) => csvCell(getLeadColumnValue(lead, column.key, ownerResponseLabel))).join(","));
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

const KeywordsField = memo(function KeywordsField({ onHasKeywordsChange }: { onHasKeywordsChange: (hasKeywords: boolean) => void }) {
  const t = useTranslations("UI");
  const s = useTranslations("Search");
  const [value, setValue] = useState("");
  const keywordCount = parseKeywords(value).length;
  const hasKeywords = keywordCount > 0;
  // Solo avisa al padre cuando cambia de vacío a con keywords (o al revés): no re-renderiza la página por cada tecla.
  useEffect(() => onHasKeywordsChange(hasKeywords), [hasKeywords, onHasKeywordsChange]);

  return (
    <label className="field field-keywords" data-onboarding="keywords">
      <span className="field-label">{t("t_f530db58b3")} <span className="required-mark">*</span></span>
      <textarea
        name="keywords"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={s("keywordsPlaceholder")}
        rows={3}
        maxLength={1200}
        aria-describedby="keywords-help"
        required
      />
      <span className="field-help" id="keywords-help">
        {t("t_ed5451877b")}{keywordCount > 0 && <> <strong>{s("keywordCount", { count: keywordCount })}</strong></>}
      </span>
    </label>
  );
});

export default function Home() {
  const t = useTranslations("UI");
  const s = useTranslations("Search");
  const locale = useLocale();
  const columnLabel: LeadColumnLabeler = useCallback((key, fallback) => {
    const numbered = /^(review|rating)_([1-5])$/.exec(key);
    if (numbered) return s(`columns.${numbered[1]}`, { number: Number(numbered[2]) });
    return s.has(`columns.${key}`) ? s(`columns.${key}`) : fallback;
  }, [s]);
  const [country, setCountry] = useState("");
  const [randomLocation, setRandomLocation] = useState(false);
  const [hasKeywords, setHasKeywords] = useState(false);
  const [province, setProvince] = useState("");
  const [district, setDistrict] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [provinceCode, setProvinceCode] = useState("");
  const [countries, setCountries] = useState<GeographyOption[]>([]);
  const [provinces, setProvinces] = useState<GeographyOption[]>([]);
  const [districts, setDistricts] = useState<GeographyOption[]>([]);
  const [geographyLoading, setGeographyLoading] = useState({ countries: true, provinces: false, districts: false });
  const [geographyError, setGeographyError] = useState("");
  const [guidedCount, setGuidedCount] = useState<number | null>(null);
  const [selectedCount, setCount] = useState(25);
  const count = guidedCount ?? selectedCount;
  const [filters, setFilters] = useState<SearchFilters>(defaultSearchFilters);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [activeBatch, setActiveBatch] = useState<LeadBatch | null>(null);
  const [busy, setBusy] = useState(false);
  const [showFullData, setShowFullData] = useState(false);
  const [notice, setNotice] = useState("");
  const [problem, setProblem] = useState("");
  const [historyLoading, setHistoryLoading] = useState(true);
  const [apifyConfigured, setApifyConfigured] = useState(false);
  const [pocketBaseConfigured, setPocketBaseConfigured] = useState(false);
  const [devOnly, setDevOnly] = useState(false);
  const [currentUser, setCurrentUser] = useState<{ id: string; email: string; credits: number } | null>(() => {
    const cached = peekSessionUser();
    return cached && cached.role !== "owner" ? { id: String(cached.id), email: String(cached.email), credits: Number(cached.credits) || 0 } : null;
  });
  const [authLoading, setAuthLoading] = useState(true);
  const [authProblem, setAuthProblem] = useState("");
  const [activeTableAction, setActiveTableAction] = useState<TableAction | null>(null);
  const [analysisBusy, setAnalysisBusy] = useState<TableAction | null>(null);
  const [analysisRowBusyId, setAnalysisRowBusyId] = useState("");
  const [analysisDiagnostics, setAnalysisDiagnostics] = useState<AnalysisDiagnostic[]>([]);
  const [analysisDiagnosticsOpen, setAnalysisDiagnosticsOpen] = useState(false);
  const [analysisScope, setAnalysisScope] = useState<AnalysisScope>("batch");
  const [analysisLeadId, setAnalysisLeadId] = useState("");
  const [selectedSocialNetworks, setSelectedSocialNetworks] = useState<SocialNetwork[]>(socialNetworkOptions.map(({ id }) => id));
  const painFocus = useSyncExternalStore(subscribePainFocus, readPainFocus, () => "");
  // Last value known to be stored in the profile; saves start only once it loaded (profileLoaded).
  const savedServiceRef = useRef("");
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [analysisDialog, setAnalysisDialog] = useState<{ leadId: string; action: TableAction; view?: "proposals"; tag?: string } | null>(null);
  const [copiedProposal, setCopiedProposal] = useState<string | null>(null);
  // ponytail: edits live in page state (survive dialog close/open, not reload); sessionStorage if reload persistence needed
  const [proposalEdits, setProposalEdits] = useState<Record<string, string>>({});
  const [cellDetail, setCellDetail] = useState<{ leadId: string; title: string; value: string } | null>(null);
  const cellDetailAnchorRef = useRef<HTMLTableCellElement>(null);
  const lastAnalysisTapRef = useRef<{ key: string; at: number } | null>(null);
  const analysisPopoverRef = useRef<HTMLElement>(null);
  const tableActionCardRef = useRef<HTMLDivElement>(null);
  const tableFrameRef = useRef<HTMLDivElement>(null);
  const [selectedLeadIds, setSelectedLeadIds] = useState<ReadonlySet<string>>(() => new Set());
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null);
  const [deletingLeads, setDeletingLeads] = useState(false);
  const painFocusInputRef = useRef<HTMLInputElement>(null);

  // Load the service offering into "Foco de dolor"; migrate the legacy local value when the profile is empty.
  const currentUserId = currentUser?.id;
  useEffect(() => {
    if (!currentUserId) return;
    const controller = new AbortController();
    fetch("/api/account/profile", { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { profile?: { serviceOffering?: string } } | null) => {
        if (!data?.profile) return;
        const stored = data.profile.serviceOffering ?? "";
        savedServiceRef.current = stored;
        // Empty profile keeps the local value, which the save effect below then migrates.
        if (stored) setPainFocus(stored);
        setProfileLoaded(true);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [currentUserId]);

  // Editing the field saves it to the profile (debounced); the first run after loading migrates the local value.
  useEffect(() => {
    if (!currentUserId || !profileLoaded) return;
    const value = painFocus.trim();
    if (value === savedServiceRef.current) return;
    const timer = window.setTimeout(() => {
      fetch("/api/account/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ serviceOffering: value }) })
        .then((response) => (response.ok ? response.json() : null))
        .then((data: { profile?: { serviceOffering?: string } } | null) => { if (data?.profile) savedServiceRef.current = data.profile.serviceOffering ?? ""; })
        .catch(() => undefined);
    }, PROFILE_SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [painFocus, currentUserId, profileLoaded]);
  const batchSizes = guidedCount ? [guidedCount] : devOnly ? [1, 2, ...productionBatchSizes] : productionBatchSizes;
  const numberLocale = locale === "es" ? "es-AR" : "en-US";
  const googleAuthError = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("authError") === "google"
    ? s("googleAuthFailed")
    : "";

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/geography?level=countries", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("countries");
        const options = await response.json() as GeographyOption[];
        setCountries(options);
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setGeographyError(s("geoCountriesError"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setGeographyLoading((current) => ({ ...current, countries: false }));
      });
    return () => controller.abort();
  }, [s]);

  useEffect(() => {
    if (!countryCode) return;
    const controller = new AbortController();
    fetch(`/api/geography?level=provinces&country=${encodeURIComponent(countryCode)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("provinces");
        setProvinces(await response.json() as GeographyOption[]);
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setGeographyError(s("geoProvincesError"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setGeographyLoading((current) => ({ ...current, provinces: false }));
      });
    return () => controller.abort();
  }, [countryCode, s]);

  useEffect(() => {
    if (!countryCode || !provinceCode) return;
    const controller = new AbortController();
    fetch(`/api/geography?level=districts&country=${encodeURIComponent(countryCode)}&province=${encodeURIComponent(provinceCode)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("districts");
        setDistricts(await response.json() as GeographyOption[]);
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setGeographyError(s("geoDistrictsError"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setGeographyLoading((current) => ({ ...current, districts: false }));
      });
    return () => controller.abort();
  }, [countryCode, provinceCode, s]);
  const tableColumns: TableColumn[] = useMemo(() => showFullData
    // Vista completa: una columna por red, siempre, después de Website.
    ? getLeadColumns(leads, [], true, columnLabel)
      .filter((column) => !column.key.startsWith("social_"))
      .flatMap<TableColumn>((column) => column.key === "phone"
        ? [column, { key: "whatsapp", label: s("columns.whatsapp") }]
        : column.key === "website"
          ? [column, ...socialNetworkOptions.map(({ id, label }) => ({ key: `social_${id}` as const, label }))]
          : [column])
    : [
      { key: "name", label: s("compactColumns.business") },
      { key: "phone", label: s("columns.phone") },
      { key: "email", label: s("columns.email") },
      { key: "socials", label: s("compactColumns.socials") },
      { key: "pain_points", label: s("compactColumns.pain") },
    ], [
    showFullData,
    leads,
    columnLabel,
    s,
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
    setCellDetail({ leadId: lead.id, title: column.label, value: value || s("noData") });
  }

  function openLinkedCellDetail(event: MouseEvent<HTMLAnchorElement>, lead: Lead, column: TableColumn, value: string) {
    event.preventDefault();
    cellDetailAnchorRef.current = event.currentTarget.closest("td");
    setCellDetail({ leadId: lead.id, title: column.label, value: value || s("noData") });
  }

  // Selection only counts leads still visible (new search / batch switch drops stale ids without an effect).
  const selectedVisibleIds = leads.filter((lead) => selectedLeadIds.has(lead.id)).map((lead) => lead.id);
  const allVisibleSelected = leads.length > 0 && selectedVisibleIds.length === leads.length;

  function toggleLeadSelection(leadId: string) {
    setSelectedLeadIds((current) => {
      const next = new Set(current);
      if (!next.delete(leadId)) next.add(leadId);
      return next;
    });
  }

  async function deleteLeads(ids: string[]) {
    if (!activeBatch || ids.length === 0) return;
    const removed = new Set(ids);
    const previous = leads;
    setPendingDelete(null);
    setDeletingLeads(true);
    setProblem("");
    // Optimistic: drop rows now, restore on failure. Export reads this same state.
    setLeads((current) => current.filter((lead) => !removed.has(lead.id)));
    setSelectedLeadIds(new Set());
    try {
      const response = await fetch("/api/leads", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId: activeBatch.id, leadIds: ids }),
      });
      const payload = await response.json().catch(() => null) as { deleted?: number; failed?: string[]; error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || s("deleteLeadsFailed"));
      const failed = new Set(Array.isArray(payload?.failed) ? payload.failed : []);
      if (failed.size) {
        setLeads((current) => [...current, ...previous.filter((lead) => failed.has(lead.id) && !current.some((item) => item.id === lead.id))]);
        setProblem(s("deleteLeadsPartial", { count: failed.size }));
      }
      setNotice(s("deleteLeadsDone", { count: payload?.deleted ?? ids.length - failed.size }));
    } catch (error) {
      setLeads(previous);
      setProblem(error instanceof Error ? error.message : s("deleteLeadsFailed"));
    } finally {
      setDeletingLeads(false);
      tableFrameRef.current?.focus();
    }
  }

  function cellDetailProps(lead: Lead, column: TableColumn, value: string) {
    return {
      tabIndex: 0,
      "aria-haspopup": "dialog" as const,
      "aria-label": s("cellDetailAria", { column: column.label, lead: lead.name }),
      onClick: (event: MouseEvent<HTMLTableCellElement>) => openCellDetail(event, lead, column, value),
      onKeyDown: (event: ReactKeyboardEvent<HTMLTableCellElement>) => openCellDetail(event, lead, column, value),
    };
  }

  useEffect(() => {
    // ?ref=<code> from a shared link: remember it (httpOnly cookie) until signup.
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (!ref) return;
    void fetch("/api/referrals/capture", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: ref }) }).catch(() => undefined);
  }, []);

  useEffect(() => {
    let current = true;
    async function loadInitialData() {
      try {
        // Session, status and batches are independent: fetch in parallel instead of in series.
        const statusRequest = fetch("/api/status", { cache: "no-store" }).then((result) => result.json());
        const batchesRequest = fetch("/api/batches", { cache: "no-store" }).then(async (result) => ({ ok: result.ok, payload: await result.json() }));
        statusRequest.catch(() => undefined);
        batchesRequest.catch(() => undefined);
        const authPayload = await getSession();
        if (!authPayload.ok) throw new Error(authPayload.error || s("accountConnectionFailed"));
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

        const status = await statusRequest;
        if (current) {
          setApifyConfigured(Boolean(status.apifyConfigured));
          setPocketBaseConfigured(Boolean(status.pocketBaseConfigured));
          setDevOnly(status.devOnly === true);
        }

        const { ok: batchesOk, payload } = await batchesRequest;
        if (!batchesOk) throw new Error(payload.error || s("historyLoadFailed"));
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
        setAuthProblem(error instanceof Error ? error.message : s("accountConnectionFailed"));
        setAuthLoading(false);
        setHistoryLoading(false);
        setProblem(error instanceof Error ? error.message : s("historyConnectionFailed"));
      }
    }
    void loadInitialData();
    return () => { current = false; };
  }, [s]);

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
    await fetch("/api/auth/logout", { method: "POST" });
    invalidateSession();
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
      setProblem(s("keywordRequired"));
      return;
    }
    if (!randomLocation && !country.trim()) {
      setProblem(s("countryRequired"));
      return;
    }

    setBusy(true);
    setLeads([]);
    setActiveBatch(null);
    setNotice(s("searching"));

    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keywords, count,
          ...(randomLocation ? { random: true } : { country, province, district }),
          filters: {
            ...filters,
            minReviews: filters.minReviews === "" ? undefined : Number(filters.minReviews),
            minRating: filters.minRating === "" ? undefined : Number(filters.minRating),
          },
        }),
      });
      const payload = await response.json();
      if (typeof payload.credits === "number") {
        setSessionCredits(payload.credits);
        setCurrentUser((user) => user ? { ...user, credits: payload.credits } : user);
      }
      if (!response.ok) throw new Error(payload.error || s("searchFailed"));

      const newBatch = ((await fetch("/api/batches", { cache: "no-store" }).then((result) => result.json())).batches as LeadBatch[])
        .find((batch) => batch.id === payload.batchId);
      setLeads(payload.leads as Lead[]);
      if (newBatch) {
        setActiveBatch(newBatch);
      }
      setNotice(s("searchSaved", { count: payload.leads.length }));
      if (payload.shortfall) {
        setProblem(`${s("searchShortfall")}${payload.warning ? ` ${payload.warning}` : ""}`);
      } else if (payload.warning) {
        setProblem(`${s("searchPartial")} ${payload.warning}`);
      }
    } catch (error) {
      setNotice("");
      setProblem(error instanceof Error ? error.message : s("searchFailed"));
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
    setNotice(action === "pain_points" ? s("analyzingPains") : s("analyzingNetworks"));
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
        setSessionCredits(payload.credits);
        setCurrentUser((user) => user ? { ...user, credits: payload.credits } : user);
      }
      if (!response.ok) throw new Error(payload.error || s("analysisFailed"));
      setLeads(payload.leads as Lead[]);
      const diagnostics = Array.isArray(payload.diagnostics) ? payload.diagnostics as AnalysisDiagnostic[] : [];
      setAnalysisDiagnostics(diagnostics);
      if (diagnostics.length > 0) setAnalysisDiagnosticsOpen(true);
      if (action === "pain_points") {
        setNotice(s("painsDone", { analyzed: payload.analyzedCount, findings: payload.findingCount || 0 }));
      } else {
        setNotice(s("enrichDone", { count: payload.analyzedCount }));
      }
      if (payload.noEvidenceCount > 0 || payload.failedCount > 0 || payload.skippedCount > 0 || payload.limitedCount > 0) {
        const issues: string[] = [];
        if (payload.noEvidenceCount > 0) {
          issues.push(action === "pain_points"
            ? s("issueNoEvidencePains", { count: payload.noEvidenceCount })
            : s("issueNoEvidenceEnrich", { count: payload.noEvidenceCount }));
        }
        const failureMessages = Array.isArray(payload.failures)
          ? [...new Set(payload.failures.map((failure: { message?: unknown }) => typeof failure?.message === "string" ? failure.message : "" ).filter(Boolean))]
          : [];
        if (payload.skippedCount > 0) issues.push(s("issueSkipped", { count: payload.skippedCount }));
        if (payload.limitedCount > 0) issues.push(s("issueEnrichLimit", { count: payload.limitedCount, limit: 250 }));
        if (payload.failedCount > 0) {
          issues.push(failureMessages.length ? s("issueFailedDetail", { count: payload.failedCount, details: failureMessages.join("; ") }) : s("issueFailed", { count: payload.failedCount }));
        }
        setProblem(`${issues.join(". ")}.`);
      }
    } catch (error) {
      setNotice("");
      setProblem(error instanceof Error ? error.message : s("analysisFailed"));
    } finally {
      setAnalysisBusy(null);
      setAnalysisRowBusyId("");
    }
  }

  // Sin foco definido en la configuración se mantiene el pedido: abre la tarjeta de dolor para esa fila y enfoca el campo.
  function requestPainAnalysis(leadId: string) {
    if (painFocus.trim()) {
      void startAnalysis("pain_points", leadId);
      return;
    }
    setAnalysisScope("row");
    setAnalysisLeadId(leadId);
    setActiveTableAction("pain_points");
    requestAnimationFrame(() => painFocusInputRef.current?.focus());
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

  // Shell visible from the first paint: sidebar skeleton (or cached session) while auth resolves.
  if (authLoading) return (
    <main className="app-shell">
      <AppSidebar active="search" user={currentUser} onSignOut={signOut} />
      <div className="workspace"><p className="auth-loading" aria-live="polite">{t("t_50aa6fdfd6")}</p></div>
    </main>
  );
  if (!currentUser) return <AuthForm initialError={authProblem || googleAuthError} initialMode={typeof window !== "undefined" && new URLSearchParams(window.location.search).get("signup") === "1" || new URLSearchParams(window.location.search).has("ref") ? "register" : "login"} onAuthenticated={() => window.location.reload()} />;

  return (
    <main className="app-shell">
      <AppSidebar active="search" user={currentUser} onSignOut={signOut} />

      <div className="workspace">
        <form className="search-panel" onSubmit={submitSearch}>
          <div className="panel-heading" data-onboarding="intro">
            <div>
              <h1 className="brand-title">{s("pageTitle")}<span className="brand-period" aria-hidden="true">.</span></h1>
              <p>{s("pageSubtitle")}</p>
            </div>
            <div className="onboarding-aside">
              <Onboarding
                userId={currentUser.id}
                ready={!historyLoading}
                hasHistory={Boolean(activeBatch)}
                hasCountry={randomLocation || Boolean(country.trim())}
                busy={busy}
                resultCount={leads.length}
                onGuidedCountChange={setGuidedCount}
              />
              <span className="required-note"><span aria-hidden="true">*</span> {t("t_f128ad0f39")}</span>
            </div>
          </div>

          <div className="form-grid">
            <KeywordsField onHasKeywordsChange={setHasKeywords} />

            <div className="field geography-field" data-onboarding="location">
              <span className="field-label">{t("t_ae0ddfcae9")} {!randomLocation && <span className="required-mark">*</span>}</span>
              <label className="full-data-toggle random-location-toggle">
                <input type="checkbox" role="switch" checked={randomLocation} onChange={(event) => setRandomLocation(event.target.checked)} disabled={busy} />
                <span className="full-data-track" aria-hidden="true" />
                <span>{s("randomLocation")}</span>
              </label>
              {randomLocation && <span className="field-help">{s("randomLocationHelp")}</span>}
              <div className="location-grid" hidden={randomLocation}>
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
                    required={!randomLocation}
                    aria-label={s("countryAria")}
                    disabled={geographyLoading.countries || countries.length === 0}
                  >
                    <option value="">{geographyLoading.countries ? s("countryLoading") : s("countryPlaceholder")}</option>
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
                    aria-label={s("provinceAria")}
                    disabled={!countryCode || geographyLoading.provinces || provinces.length === 0}
                  >
                    <option value="">{geographyLoading.provinces ? s("provinceLoading") : s("provincePlaceholder")}</option>
                    {provinces.map((option) => <option value={option.code} key={option.code}>{option.name}</option>)}
                  </select><span className="select-chevron" aria-hidden="true" /></span>
                </label>
                <label>
                  <span className="sr-only">{t("t_c6e0bdca3e")}</span>
                  <span className="select-control"><select
                    value={district}
                    onChange={(event) => setDistrict(event.target.value)}
                    aria-label={s("districtAria")}
                    disabled={!provinceCode || geographyLoading.districts || districts.length === 0}
                  >
                    <option value="">{geographyLoading.districts ? s("districtLoading") : s("districtPlaceholder")}</option>
                    {districts.map((option) => <option value={option.name} key={option.code}>{option.name}</option>)}
                  </select><span className="select-chevron" aria-hidden="true" /></span>
                </label>
              </div>
              {!randomLocation && <span className="field-help">{t("t_08a1c28ca4")}</span>}
              {geographyError && <span className="field-error" role="alert">{geographyError}</span>}
            </div>

            <fieldset className="field batch-field" data-onboarding="count">
              <legend className="field-label">{t("t_cad2c8e692")}{devOnly && <span className="test-mode-label">{t("t_be14c472da")}</span>}</legend>
              <div className="batch-options" role="radiogroup" aria-label={s("batchGroupAria")}>
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

            <label className="field service-focus-field">
              <span className="field-label">{s("serviceFocusLabel")} <span className="optional-mark">{s("optional")}</span></span>
              <input
                type="text"
                value={painFocus}
                maxLength={300}
                placeholder={s("painFocusPlaceholder")}
                onChange={(event) => setPainFocus(event.target.value)}
                disabled={Boolean(analysisBusy)}
              />
              <span className="field-help">{s("serviceFocusHelp")}</span>
            </label>

            <SearchFiltersPanel filters={filters} setFilters={setFilters} disabled={busy} />

            <div className="search-action">
              <button className="primary-button" type="submit" data-onboarding="submit" disabled={busy || !hasKeywords || !apifyConfigured || !pocketBaseConfigured || (!randomLocation && !country.trim())}>
                {busy ? <><span className="button-spinner" aria-hidden="true" /> {t("t_b6d453ae3d")}</> : s("searchButton")}
              </button>
              <span className="action-caption">{!apifyConfigured ? s("missingApify") : !pocketBaseConfigured ? s("missingPocketBase") : s("maxPerBatch", { count })}</span>
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
            {devOnly && analysisDiagnostics.length > 0 && (
              <button type="button" className="diagnostic-open-button" onClick={() => setAnalysisDiagnosticsOpen(true)}>
                <Bug size={14} aria-hidden="true" /> {t("t_9c2aa37466")} </button>
            )}
            {problem && <ErrorReportButton message={problem} action={analysisBusy ? `analysis:${analysisBusy}` : undefined} />}
            {problem && <button type="button" className="dismiss-button" onClick={() => setProblem("")}>{t("t_4b0816bbd5")}</button>}
          </div>
        )}

        <section className="results-section" id="history-section" aria-labelledby="results-title">
          <div className="results-heading">
            <div>
              <div className="results-title-row">
                <h2 id="results-title">{s("resultsTitle")}</h2>
                <span className="result-count">{leads.length}</span>
              </div>
              {activeBatch && (() => {
                // Same value on both sides (e.g. "Manual · Manual") is shown once.
                const place = placeLabel(activeBatch);
                const keywords = activeBatch.keywords.join(", ");
                const parts = [...new Set([place, keywords].filter(Boolean))];
                return <p className="active-location">{parts.map((part, index) => <Fragment key={part}>{index > 0 && <> <span>·</span> </>}{part}</Fragment>)}</p>;
              })()}
            </div>
            <div className="results-actions">
          <label className="full-data-toggle">
                <input type="checkbox" role="switch" checked={showFullData} onChange={(event) => setShowFullData(event.target.checked)} />
                <span className="full-data-track" aria-hidden="true" />
            <span>{s("showFullData")}</span>
              </label>
              <button className="export-button" type="button" onClick={() => downloadCsv(leads, activeBatch, columnLabel, s("ownerResponse"))} disabled={leads.length === 0}>
                {t("t_8b9c2038c4")} </button>
            </div>
          </div>

          {activeTableAction && (
            <div className="table-action-card" id="table-action-card" ref={tableActionCardRef} role="region" aria-labelledby="table-action-title">
              <div className="table-action-card-main">
                <Sparkles className="ai-sparkle table-action-card-sparkle" size={18} strokeWidth={1.8} aria-hidden="true" />
                <div>
                  <h3 id="table-action-title">{s(`actions.${activeTableAction}.title`)}</h3>
                  <p>{s(`actions.${activeTableAction}.description`)}</p>
                  {activeTableAction === "pain_points" && <small>{t("t_6e30ea45d9")}</small>}
                </div>
              </div>
              <div className="table-action-controls">
                {activeTableAction === "pain_points" && (
                  <label className="analysis-focus-field">
                    <span>{t("t_ea9c745083")}</span>
                    <input
                      ref={painFocusInputRef}
                      type="text"
                      value={painFocus}
                      maxLength={300}
                      placeholder={s("painFocusPlaceholder")}
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
                {activeTableAction === "enrichment" && (
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
                {analysisBusy === activeTableAction ? <><LoaderCircle className="button-spinner-icon" aria-hidden="true" /> {t("t_740ecf6aec")}</> : activeTableAction === "pain_points" ? s("analyzePains") : s(`actions.${activeTableAction}.cta`)}
              </button>
              <button className="table-action-close" type="button" aria-label={s("closeCard")} onClick={() => setActiveTableAction(null)}><X size={18} aria-hidden="true" /></button>
            </div>
          )}

          {(selectedVisibleIds.length > 0 || pendingDelete) && (
            <div className="lead-selection-bar" role={pendingDelete ? "alertdialog" : "region"} aria-label={pendingDelete ? s("deleteLeadsConfirm", { count: pendingDelete.length }) : s("selectionBarAria")}
              onKeyDown={(event) => { if (event.key === "Escape" && pendingDelete) setPendingDelete(null); }}>
              {pendingDelete ? (
                <>
                  <span>{s("deleteLeadsConfirm", { count: pendingDelete.length })}</span>
                  <div className="lead-selection-actions">
                    <button className="export-button" type="button" autoFocus onClick={() => setPendingDelete(null)}>{s("cancelDelete")}</button>
                    <button className="danger-button" type="button" disabled={deletingLeads} onClick={() => void deleteLeads(pendingDelete)}><Trash2 size={16} aria-hidden="true" /> {s("confirmDelete")}</button>
                  </div>
                </>
              ) : (
                <>
                  <span>{s("selectedCount", { count: selectedVisibleIds.length })}</span>
                  <div className="lead-selection-actions">
                    <button className="export-button" type="button" onClick={() => setSelectedLeadIds(new Set())}>{s("clearSelection")}</button>
                    <button className="danger-button" type="button" disabled={deletingLeads || busy} onClick={() => setPendingDelete(selectedVisibleIds)}><Trash2 size={16} aria-hidden="true" /> {s("deleteSelected", { count: selectedVisibleIds.length })}</button>
                  </div>
                </>
              )}
            </div>
          )}

          <p className="table-scroll-hint">{t("t_00c94041d2")}</p>
          <div className="table-frame" ref={tableFrameRef} data-onboarding="results" tabIndex={0} aria-label={s("resultsTableAria")}>
            <table className={showFullData ? undefined : "compact-lead-table"}>
              <thead>
                <tr><th scope="col" className="lead-select-cell">
                  <input type="checkbox" checked={allVisibleSelected} disabled={leads.length === 0 || deletingLeads} aria-label={s("selectAllLeads")}
                    onChange={() => setSelectedLeadIds(allVisibleSelected ? new Set() : new Set(leads.map((lead) => lead.id)))} />
                </th>{tableColumns.map((column) => {
                  const action: TableAction | null = column.key === "pain_points" ? "pain_points" : column.key === "enrichment" ? "enrichment" : null;
                  return (
                    <th key={column.key} scope="col">
                      {action ? (
                        <button
                          className="table-action-header"
                          type="button"
                          title={s(`actions.${action}.title`)}
                          aria-label={s(`actions.${action}.title`)}
                          aria-expanded={activeTableAction === action}
                          aria-controls="table-action-card"
                          onClick={() => setActiveTableAction((current) => {
                            if (current === action) return null;
                            setAnalysisScope("batch");
                            setAnalysisLeadId(leads[0]?.id ?? "");
                            return action;
                          })}
                        >
                          <Sparkles className="ai-sparkle" size={16} strokeWidth={1.8} aria-hidden="true" />
                          <span>{column.label}</span>
                        </button>
                      ) : column.label}
                    </th>
                  );
                })}</tr>
              </thead>
              <tbody>
                {leads.map((lead) => {
                  const enrichmentAttempted = Boolean(lead.enrichment_detail?.status || lead.enrichment?.trim());
                  // Enriquecer está disponible en todos los entornos.
                  const enrichButton = !enrichmentAttempted
                    ? <button className="analysis-cell-trigger is-enrich" type="button" disabled={Boolean(analysisBusy)} onClick={() => void startAnalysis("enrichment", lead.id)} aria-label={s("enrichMailAria", { name: lead.name })}>{analysisBusy === "enrichment" && (!analysisRowBusyId || analysisRowBusyId === lead.id) ? s("enriching") : s("enrich")}</button>
                    : null;
                  return (
                  <tr key={lead.id} className={selectedLeadIds.has(lead.id) ? "is-selected" : undefined}>
                    <td className="lead-select-cell">
                      <input type="checkbox" checked={selectedLeadIds.has(lead.id)} disabled={deletingLeads} aria-label={s("selectLead", { name: lead.name })} onChange={() => toggleLeadSelection(lead.id)} />
                      <button className="lead-delete-button" type="button" disabled={deletingLeads || busy} aria-label={s("deleteLead", { name: lead.name })} title={s("deleteLead", { name: lead.name })} onClick={() => setPendingDelete([lead.id])}><Trash2 size={15} aria-hidden="true" /></button>
                    </td>
                    {tableColumns.map((column) => {
                      if (column.key === "whatsapp") {
                        return <td key={column.key} {...cellDetailProps(lead, column, lead.phone || s("noData"))}><WhatsAppContact phone={lead.phone} /></td>;
                      }
                      if (column.key === "socials") {
                        const profiles = socialNetworkOptions.flatMap(({ id, label, Icon }) => {
                          const url = getSocialProfileUrl(lead.social_profiles || "", id);
                          return url ? [{ id, label, Icon, url }] : [];
                        });
                        const value = profiles.map((profile) => profile.label).join(", ") || s("noData");
                        return <td key={column.key} className="compact-social-cell" {...cellDetailProps(lead, column, value)}>
                          {profiles.length
                            ? <div className="compact-social-links">{profiles.map(({ id, label, Icon, url }) => (
                              <a className={`social-pill is-${id}`} key={id} href={url} target="_blank" rel="noreferrer" title={url}>
                                <Icon aria-hidden="true" />
                                <span>{label}</span>
                              </a>
                            ))}</div>
                            : enrichButton ?? <span className="compact-missing">{s("noData")}</span>}
                        </td>;
                      }
                      if (column.key === "name" && !showFullData) {
                        const businessDetails = [lead.category, lead.average_rating ? `★ ${lead.average_rating}${lead.review_count ? ` (${lead.review_count})` : ""}` : ""].filter(Boolean).join(" · ");
                        return <td key={column.key} className="compact-business-cell" {...cellDetailProps(lead, column, [lead.name, businessDetails, lead.address].filter(Boolean).join("\n"))}>
                          {lead.maps_url
                            ? <a className="compact-business-name" href={lead.maps_url} target="_blank" rel="noreferrer">{lead.name}</a>
                            : <strong className="compact-business-name">{lead.name}</strong>}
                          {businessDetails && <span className="compact-business-meta">{businessDetails}</span>}
                        </td>;
                      }
                      const reviewMatch = /^review_([1-5])$/.exec(column.key);
                      if (reviewMatch) {
                        const review = lead.source_reviews?.[Number(reviewMatch[1]) - 1];
                        const reviewDetail = review
                          ? [
                              review.rating === null ? "" : s("reviewRating", { rating: review.rating }),
                              review.published_at ? s("reviewDate", { date: reviewDate(review.published_at, locale) }) : "",
                              review.text,
                              review.owner_response ? `${s("ownerResponse")}: ${review.owner_response}` : "",
                            ].filter(Boolean).join("\n\n")
                          : s("noReview");
                        return <td className="lead-review-cell" key={column.key} title={review?.text || ""} {...cellDetailProps(lead, column, reviewDetail)}>
                          {review && <>
                            <span className="lead-review-meta">{[review.rating === null ? "" : `${review.rating}/5`, review.published_at ? reviewDate(review.published_at, locale) : ""].filter(Boolean).join(" · ")}</span>
                            <span className="lead-review-copy">{review.text}</span>
                            {review.owner_response && <span className="lead-review-response">{t("t_852c5e0706")} {review.owner_response}</span>}
                          </>}
                        </td>;
                      }
                      const value = getLeadColumnValue(lead, column.key, s("ownerResponse"));
                      if (column.key === "email" && !value && enrichButton) {
                        return <td key={column.key} {...cellDetailProps(lead, column, s("mailNotEnriched"))}>{enrichButton}</td>;
                      }
                      if (!showFullData && (column.key === "phone" || column.key === "email") && !value) {
                        return <td key={column.key} className="compact-missing-cell">{s("noData")}</td>;
                      }
                      if (!showFullData && column.key === "phone") {
                        // Same WhatsApp trigger/popover as the full-data WhatsApp column.
                        // Whole cell opens the WhatsApp popover; clicks on the trigger itself are handled by it (no double toggle).
                        const openWhatsApp = (event: MouseEvent<HTMLTableCellElement> | ReactKeyboardEvent<HTMLTableCellElement>) => {
                          if ("key" in event && event.key !== "Enter" && event.key !== " ") return;
                          if (event.target instanceof Element && event.target.closest("a,button,input,textarea,select,[role='dialog']")) return;
                          event.preventDefault();
                          event.currentTarget.querySelector<HTMLButtonElement>(".whatsapp-contact-trigger")?.click();
                        };
                        return <td key={column.key} tabIndex={0} aria-label={`${column.label}: ${lead.phone}`} onClick={openWhatsApp} onKeyDown={openWhatsApp}><span className="compact-phone"><FaWhatsapp aria-hidden="true" /><WhatsAppContact phone={lead.phone} /></span></td>;
                      }
                      const socialNetworkMatch = /^social_(facebook|instagram|youtube|linkedin)$/.exec(column.key);
                      if (socialNetworkMatch) {
                        const network = socialNetworkMatch[1] as SocialNetwork;
                        const networkWasSelected = lead.enrichment_detail?.social_networks?.includes(network);
                        return <td key={column.key} title={String(value || "")} {...cellDetailProps(lead, column, String(value || (networkWasSelected ? s("noData") : s("noProfile"))))}>{value
                          ? <a className="table-link" href={String(value)} target="_blank" rel="noreferrer" onClick={(event) => openLinkedCellDetail(event, lead, column, String(value))}>{t("t_3afc60274c")}</a>
                          : networkWasSelected ? <span className="analysis-cell-empty is-no-data">{t("t_29b2157143")}</span> : ""}</td>;
                      }
                      if (column.key === "pain_points" || column.key === "enrichment") {
                        const action: TableAction = column.key;
                        const detail = analysisDetail(action === "pain_points" ? lead.pain_points_detail : lead.enrichment_detail);
                        const pain = action === "pain_points" ? painView(detail, lead.pain_points) : null;
                        const content = pain
                          ? (pain.tags.join("; ") || pain.report)
                          : String(value || "");
                        const fullAnalysis = pain
                          ? [
                              pain.tags.join(" · "),
                              pain.report,
                              detail?.findings.map((finding) => [finding.title, finding.detail, ...finding.sources.map((source) => `${source.label}: ${source.text}${source.url ? ` (${source.url})` : ""}`)].filter(Boolean).join("\n")).join("\n\n"),
                            ].filter(Boolean).join("\n\n") || content
                          : [detail?.summary, content].filter((part, index, parts) => Boolean(part) && parts.indexOf(part) === index).join("\n\n");
                        const noData = !content && Boolean(detail?.status);
                        const needsAnalysis = !content && !noData;
                        const cellText = content || (action === "pain_points" && detail?.status === "completed" ? s("noPains") : noData ? s("noData") : s("notAnalyzed"));
                        return (
                          <td key={column.key} className="analysis-cell" {...cellDetailProps(lead, column, fullAnalysis || cellText)} {...(pain && pain.tags.length > 0 ? {
                            // Pills/buttons keep their own handlers; the rest of the cell opens the pain dialog on the first tag.
                            onClick: (event: MouseEvent<HTMLTableCellElement>) => {
                              if (event.target instanceof Element && event.target.closest("a,button,input,textarea,select,[role='dialog']")) return;
                              setAnalysisDialog({ leadId: lead.id, action: "pain_points", tag: pain.tags[0] });
                            },
                            onKeyDown: (event: ReactKeyboardEvent<HTMLTableCellElement>) => {
                              if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
                              event.preventDefault();
                              setAnalysisDialog({ leadId: lead.id, action: "pain_points", tag: pain.tags[0] });
                            },
                          } : {})}>
                            {needsAnalysis && action === "pain_points"
                              ? <button
                                className="analysis-cell-trigger is-enrich"
                                type="button"
                                disabled={Boolean(analysisBusy)}
                                onClick={() => requestPainAnalysis(lead.id)}
                                aria-label={s("analyzePainAria", { name: lead.name })}
                              >
                                {analysisBusy === action && (!analysisRowBusyId || analysisRowBusyId === lead.id) ? s("analyzing") : s("analyzePain")}
                              </button>
                              : pain && pain.tags.length > 0
                              ? <span className="pain-tags">
                                {pain.tags.map((tag) => (
                                  <button className="pain-tag pain-tag-button" type="button" key={tag} title={s("openPainHint")} onKeyDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setAnalysisDialog({ leadId: lead.id, action: "pain_points", tag }); }}>{tag}</button>
                                ))}
                                {showFullData && pain.report && <span className="pain-report">{pain.report}</span>}
                              </span>
                              : <button
                              className={`analysis-cell-trigger${noData ? " is-no-data" : ""}${pain?.hasContent ? " has-pain-tags" : ""}`}
                              type="button"
                              disabled={needsAnalysis && Boolean(analysisBusy)}
                              onClick={needsAnalysis ? () => void startAnalysis(action, lead.id) : (event) => {
                                cellDetailAnchorRef.current = event.currentTarget.closest("td");
                                setCellDetail({ leadId: lead.id, title: column.label, value: fullAnalysis || cellText });
                              }}
                              onPointerUp={needsAnalysis ? undefined : (event) => handleAnalysisCellPointer(lead, action, event.pointerType, event.timeStamp)}
                              onDoubleClick={needsAnalysis ? undefined : () => setAnalysisDialog({ leadId: lead.id, action })}
                              onKeyDown={needsAnalysis ? undefined : (event) => { if (event.key === "Enter" || event.key === " ") setAnalysisDialog({ leadId: lead.id, action }); }}
                              title={needsAnalysis ? s("analyzeLead") : s("openAnalysisHint")}
                            >
                              {analysisBusy === action && needsAnalysis && (!analysisRowBusyId || analysisRowBusyId === lead.id)
                                ? s("analyzing")
                                : pain?.hasContent
                                  ? <span className="pain-report-line">{pain.report}</span>
                                  : cellText}
                            </button>}
                            {pain && (detail?.proposals?.length ?? 0) > 0 && (
                              <button className="pain-tag proposal-pill" type="button" onKeyDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setAnalysisDialog({ leadId: lead.id, action: "pain_points", view: "proposals" }); }}>{s("viewProposal")}</button>
                            )}
                            {detail && <span className="analysis-source-count">{detail.findings.length} {t("t_a1c92c8aa4")}</span>}
                          </td>
                        );
                      }
                      if (column.key === "email" && !value) {
                        return <td key={column.key} {...cellDetailProps(lead, column, s("noData"))}><span className="analysis-cell-empty is-no-data">{t("t_29b2157143")}</span></td>;
                      }
                      const isLink = (column.key === "maps_url" || column.key === "website") && Boolean(value);
                      const ratingColumn = /^rating_[1-5]$/.test(column.key);
                      return (
                        <td key={column.key} className={ratingColumn ? "rating-breakdown-cell" : undefined} {...cellDetailProps(lead, column, value == null || value === "" ? s("noData") : String(value))}>
                          {isLink ? <a className="table-link" href={String(value)} target="_blank" rel="noreferrer" title={column.key === "maps_url" ? s("columns.maps_url") : String(value)} onClick={(event) => openLinkedCellDetail(event, lead, column, String(value))}>{column.key === "maps_url" ? s("columns.maps_url") : String(value)}</a> : value == null ? "" : String(value)}
                        </td>
                      );
                    })}
                  </tr>
                  );
                })}
                {leads.length === 0 && !busy && (
                  <tr><td className="empty-cell" colSpan={tableColumns.length + 1}>
                    <strong>{historyLoading ? s("connectingHistory") : s("noLeadsYet")}</strong>
                    <span>{historyLoading ? "" : s("noLeadsHint")}</span>
                  </td></tr>
                )}
                {busy && Array.from({ length: Math.min(count, 5) }, (_, index) => (
                  <tr className="skeleton-row" key={`skeleton-${index}`} aria-hidden="true">
                    <td className="lead-select-cell" />
                    {tableColumns.map((column) => <td key={column.key}><span /></td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-footer"><span>{t("t_9abf183dfd")}</span><span>{s("recordCount", { count: leads.length })}</span></div>
        </section>

        <CellDetailsPopover
          open={Boolean(cellDetail && leads.some((lead) => lead.id === cellDetail.leadId))}
          anchorRef={cellDetailAnchorRef}
          title={cellDetail?.title || s("leadDetail")}
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
                <button className="analysis-popover-close" type="button" aria-label={s("closeAnalysis")} onClick={() => setAnalysisDialog(null)}><X size={18} aria-hidden="true" /></button>
                <p className="analysis-popover-lead">{lead.name}</p>
                <h2 id="analysis-popover-title">{analysisDialog.view === "proposals" ? s("proposalsTitle") : analysisDialog.tag || s(`actions.${action}.title`)}</h2>
                {analysisDialog.view === "proposals" ? (
                  <ol className="proposal-list">
                    {(detail?.proposals ?? []).map((proposal) => {
                      const key = `${lead.id}-${proposal.variant}`;
                      const text = proposalEdits[key] ?? proposal.message;
                      const edited = text !== proposal.message;
                      return (
                      <li key={proposal.variant} className="proposal-card">
                        <span className="pain-tag">{s("proposalVariant", { variant: proposal.variant })}</span>
                        <strong>{proposal.service}</strong>
                        <textarea
                          className="proposal-message"
                          aria-label={s("proposalMessageLabel", { variant: proposal.variant })}
                          value={text}
                          rows={4}
                          onChange={(event) => { const value = event.target.value; setProposalEdits((current) => ({ ...current, [key]: value })); if (copiedProposal === key) setCopiedProposal(null); }}
                        />
                        <span className="proposal-count" aria-live="off">{s("proposalChars", { count: text.length })}</span>
                        <div className="proposal-actions">
                          <button type="button" className="proposal-copy" onClick={() => {
                            void navigator.clipboard?.writeText(text).then(() => setCopiedProposal(key)).catch(() => undefined);
                          }}>{copiedProposal === key ? s("proposalCopied") : s("copyProposal")}</button>
                          {edited && (
                            <button type="button" className="proposal-copy proposal-restore" onClick={() => { setProposalEdits((current) => { const next = { ...current }; delete next[key]; return next; }); setCopiedProposal(null); }}>{s("restoreProposal")}</button>
                          )}
                        </div>
                      </li>
                      );
                    })}
                  </ol>
                ) : detail ? (
                  <>
                    {action === "enrichment" && detail.summary && <p className="analysis-popover-summary">{detail.summary}</p>}
                    {action === "pain_points" && (() => {
                      const pain = painView(detail, lead.pain_points);
                      return pain.hasContent
                        ? <>
                          {pain.tags.length > 0 && <span className="pain-tags">{pain.tags.map((tag) => <button className="pain-tag pain-tag-button" type="button" key={tag} aria-pressed={analysisDialog.tag === tag} onClick={() => setAnalysisDialog({ leadId: lead.id, action, tag })}>{tag}</button>)}{(detail.proposals?.length ?? 0) > 0 && <button className="pain-tag proposal-pill" type="button" onClick={() => setAnalysisDialog({ leadId: lead.id, action, view: "proposals" })}>{s("viewProposal")}</button>}</span>}
                          {!analysisDialog.tag && pain.report && <p className="analysis-popover-summary">{pain.report}</p>}
                        </>
                        : <p className="analysis-popover-empty">{t("t_63b75cd9df")}</p>;
                    })()}
                    {analysisDialog.tag && findingsForTag(detail.findings, painView(detail, lead.pain_points).tags, analysisDialog.tag).length === 0 && <p className="analysis-popover-empty">{s("noPainSource")}</p>}
                    {detail.findings.length > 0 && <ol className="analysis-findings">
                      {(analysisDialog.tag ? findingsForTag(detail.findings, painView(detail, lead.pain_points).tags, analysisDialog.tag) : detail.findings).map((finding, index) => (
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
                    {devOnly && detail.limitations && <p className="analysis-limitations">{detail.limitations}</p>}
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

        {devOnly && analysisDiagnosticsOpen && (
          <aside className="analysis-debug-panel" aria-label={s("debugPanel")}>
            <div className="analysis-debug-heading">
              <div>
                <p>{t("t_09b2e55d91")}</p>
                <h2>{t("t_5c39e5458c")}</h2>
              </div>
              <button type="button" aria-label={s("closeDebug")} onClick={() => setAnalysisDiagnosticsOpen(false)}><X size={18} aria-hidden="true" /></button>
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
