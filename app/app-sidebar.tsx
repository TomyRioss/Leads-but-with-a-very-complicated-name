"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Building2, Check, ChevronDown, Headset, History, LayoutDashboard, LogOut, Megaphone, Menu, MessageSquare, Plug, Plus, PanelLeftClose, PanelLeftOpen, Send, ShieldCheck, Sparkles, Stars, X } from "lucide-react";
import { BrandLogo, BrandMark } from "@/app/brand-logo";
import { LanguageSwitcher } from "@/app/language-switcher";
import { FeedbackDialog } from "@/app/feedback-dialog";
import { IntegrationsDialog, OPEN_INTEGRATIONS_EVENT } from "@/app/integrations-dialog";
import { OPEN_FEEDBACK_EVENT, type FeedbackPrefill } from "@/app/error-report";
import { getSession } from "@/lib/client/session";
import { Link, useRouter } from "@/i18n/navigation";
import { Popover, usePopover } from "@/app/ui/popover";
import { Favicon } from "@/app/[locale]/explorar/explore-steps";
import type { Business } from "@/lib/workspace/types";
import { LEADTA_WHATSAPP } from "@/lib/plans";

type AppSidebarProps = {
  active: "history" | "leadSuite" | "leadtita" | "integrations" | "businesses" | "campaigns" | "proposals";
  /** null while the session loads: renders a same-size skeleton for account and credits. */
  user: { email: string; credits: number } | null;
  onSignOut: () => void | Promise<void>;
};

const COLLAPSED_KEY = "leadta.sideNavCollapsed";
// Runs while the HTML is parsed, before the first paint: adds a marker in <head> that CSS uses to
// show the rail until React hydrates (React 19 tolerates extra nodes in <head>).
const BOOT_SCRIPT = `try{if(localStorage.getItem("${COLLAPSED_KEY}")==="1"&&!document.getElementById("side-nav-boot-collapsed")){var m=document.createElement("meta");m.id="side-nav-boot-collapsed";document.head.appendChild(m)}}catch(e){}`;
// After the first hydration, later mounts (client navigation) read storage directly and skip the script.
let hydrated = false;

// Fallback when storage is blocked (private mode): the toggle still works for this tab.
let memoryCollapsed = false;
function readCollapsed() {
  try { return localStorage.getItem(COLLAPSED_KEY) === "1"; } catch { return memoryCollapsed; }
}

const collapseListeners = new Set<() => void>();
function subscribeCollapsed(listener: () => void) {
  collapseListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => { collapseListeners.delete(listener); window.removeEventListener("storage", listener); };
}
function writeCollapsed(next: boolean) {
  memoryCollapsed = next;
  try { localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0"); } catch { /* storage blocked: memory fallback */ }
  document.getElementById("side-nav-boot-collapsed")?.remove();
  collapseListeners.forEach((listener) => listener());
}

// Private workspace sections ("Mis negocios / campañas / propuestas"): what an /explorar run leaves in the account.
const WORKSPACE_NAV = [
  { key: "businesses", href: "/negocios", label: "navBusinesses", Icon: Building2 },
  { key: "campaigns", href: "/campanas", label: "navCampaigns", Icon: Megaphone },
  { key: "proposals", href: "/propuestas", label: "navProposals", Icon: Send },
] as const;

/** Se emite al cambiar o crear el negocio activo (también desde /onboarding): el selector recarga la lista. */
export const ACTIVE_BUSINESS_EVENT = "leadta:active-business-changed";

type BusinessList = { businesses: Business[]; activeId: string };
// Ítems propios (no .side-nav-item): el menú vive dentro del nav y el modo colapsado ocultaría sus textos.
const SWITCHER_ITEM = "flex min-h-11 w-full min-w-0 items-center gap-2.5 rounded-lg px-3 text-left text-sm font-[560] text-(color:--ink) hover:bg-(--ash-50) disabled:cursor-wait focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-(color:--ink)";

// Lista de negocios compartida entre montajes del sidebar: navegar no la vuelve a pedir ni muestra el esqueleto.
// Se pide una vez por carga de página (antes se pinta la copia de sessionStorage) y otra solo con ACTIVE_BUSINESS_EVENT.
const BUSINESSES_KEY = "leadta.businesses";
let businessCache: BusinessList | null = null;
let businessesFetched = false;
const businessListeners = new Set<() => void>();
function readBusinessCache() {
  if (!businessCache) {
    try { businessCache = JSON.parse(sessionStorage.getItem(BUSINESSES_KEY) ?? "null") as BusinessList | null; } catch { /* storage bloqueado o dato roto */ }
  }
  return businessCache;
}
function writeBusinessCache(list: BusinessList | null) {
  businessCache = list;
  try { if (list) sessionStorage.setItem(BUSINESSES_KEY, JSON.stringify(list)); else sessionStorage.removeItem(BUSINESSES_KEY); } catch { /* storage bloqueado */ }
  businessListeners.forEach((listener) => listener());
}
/** GET /api/businesses a la caché compartida; false si falló. */
function loadBusinesses() {
  return fetch("/api/businesses", { cache: "no-store" })
    .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
    .then((payload: Partial<BusinessList>) => { writeBusinessCache({ businesses: payload.businesses ?? [], activeId: payload.activeId ?? "" }); return true; })
    .catch(() => false);
}
function subscribeBusinesses(listener: () => void) {
  businessListeners.add(listener);
  return () => { businessListeners.delete(listener); };
}

/** Selector del negocio activo: lista de GET /api/businesses, cambia con PATCH /api/businesses/active. */
function BusinessSwitcher({ tip, onNavigate }: { tip: (label: string) => string | undefined; onNavigate: () => void }) {
  const t = useTranslations("BusinessSwitcher");
  const router = useRouter();
  const menu = usePopover({ menu: true });
  const closeMenu = menu.close;
  const list = useSyncExternalStore(subscribeBusinesses, readBusinessCache, () => null);
  const [failed, setFailed] = useState(false);
  const [switching, setSwitching] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    // Sin abortar: el pedido llena la caché compartida aunque este montaje ya no exista (modo estricto, navegación).
    const load = () => { void loadBusinesses().then((ok) => setFailed(!ok && !readBusinessCache())); };
    if (!businessesFetched) { businessesFetched = true; load(); }
    window.addEventListener(ACTIVE_BUSINESS_EVENT, load);
    return () => window.removeEventListener(ACTIVE_BUSINESS_EVENT, load);
  }, []);

  async function select(id: string) {
    if (!list || switching) return;
    if (id === list.activeId) { closeMenu(); return; }
    setSwitching(id);
    setError("");
    try {
      const response = await fetch("/api/businesses/active", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ businessId: id }) });
      if (!response.ok) throw new Error(String(response.status));
      const payload = await response.json().catch(() => ({})) as { activeId?: string };
      writeBusinessCache({ ...list, activeId: payload.activeId || id });
      closeMenu();
      router.refresh();
      window.dispatchEvent(new Event(ACTIVE_BUSINESS_EVENT));
    } catch {
      setError(t("error"));
    } finally {
      setSwitching("");
    }
  }

  if (failed) return null;
  if (!list) return <span className="side-nav-item side-nav-skeleton" aria-hidden="true" />;
  if (list.businesses.length === 0) {
    return (
      <Link title={tip(t("createBusiness"))} className="side-nav-item border border-dashed border-(color:--ash-300)" href="/onboarding?new=1" onClick={onNavigate}>
        <Plus className="menu-icon" size={18} strokeWidth={1.8} aria-hidden="true" />
        <span>{t("createBusiness")}</span>
      </Link>
    );
  }
  const active = list.businesses.find((item) => item.id === list.activeId) ?? list.businesses[0];
  return (
    <div className="side-nav-business">
      <button {...menu.triggerProps} type="button" aria-haspopup="menu" title={tip(active.name) ?? `${t("label")}: ${active.name}`} className="side-nav-item border border-(color:--line) bg-(--paper)">
        <span className="side-nav-chip bg-transparent! shadow-none!" aria-hidden="true"><Favicon domain={active.domain} size={20} plain /></span>
        <span className="min-w-0 flex-1 truncate"><span className="sr-only">{t("label")}: </span>{active.name}</span>
        <ChevronDown className="side-nav-account-chevron" size={16} strokeWidth={1.8} aria-hidden="true" />
      </button>
      <Popover {...menu.popoverProps} role="menu" placement="bottom-start" matchAnchorWidth className="side-nav-account-menu max-h-[60dvh] min-w-64 overflow-y-auto" aria-label={t("menuLabel")}>
        {list.businesses.map((item) => {
          const isActive = item.id === list.activeId;
          const incomplete = Boolean(item.onboardingStep) && item.onboardingStep !== "done";
          return (
            <div key={item.id} className="flex min-w-0 items-center gap-1 pr-1">
              <button type="button" role="menuitem" className={`${SWITCHER_ITEM} flex-1`} aria-current={isActive ? "true" : undefined} disabled={Boolean(switching)} onClick={() => void select(item.id)}>
                <Favicon domain={item.domain} size={20} plain />
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                {switching === item.id ? <span className="size-4 shrink-0 animate-spin rounded-full border-2 border-(color:--ash-300) border-t-(color:--ink) motion-reduce:animate-none" aria-hidden="true" />
                  : isActive ? <Check size={16} strokeWidth={2.2} className="shrink-0 text-(color:--lime-dark)" aria-label={t("active")} /> : null}
              </button>
              {incomplete ? (
                <Link role="menuitem" href={`/onboarding?business=${encodeURIComponent(item.id)}`} aria-label={t("completeAria", { name: item.name })} onClick={() => { closeMenu(); onNavigate(); }}
                  className="shrink-0 rounded-full bg-(--lime) px-2.5 py-1 text-xs font-semibold text-(color:--ink) hover:bg-(--lime-dark) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(color:--ink)">
                  {t("complete")}
                </Link>
              ) : null}
            </div>
          );
        })}
        {error ? <p role="alert" className="px-3 py-1.5 text-xs text-[#8a1c12]">{error}</p> : null}
        <div className="my-1 border-t border-(color:--line)" role="separator" />
        <Link role="menuitem" className={SWITCHER_ITEM} href="/onboarding?new=1" onClick={() => { closeMenu(); onNavigate(); }}>
          <Plus className="menu-icon" size={18} strokeWidth={1.8} aria-hidden="true" />
          <span>{t("newBusiness")}</span>
        </Link>
      </Popover>
    </div>
  );
}

/** Sidebar único de la app con sesión: colapsa en móvil, cierra con Escape o clic fuera. */
export function AppSidebar({ active, user, onSignOut }: AppSidebarProps) {
  const t = useTranslations("UI");
  const s = useTranslations("Search");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  // null on the server and during hydration: the boot marker drives CSS until React reads storage right after.
  const collapsed = useSyncExternalStore<boolean | null>(subscribeCollapsed, readCollapsed, () => null);
  const [renderBoot] = useState(() => !hydrated);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  // Owners get a shortcut back to /owner; the session promise is shared and cached, so this adds no request.
  const [isOwner, setIsOwner] = useState(false);
  useEffect(() => {
    let current = true;
    void getSession().then((result) => { if (current) setIsOwner(result.user?.role === "owner"); }, () => undefined);
    return () => { current = false; };
  }, []);
  const [integrationsOpen, setIntegrationsOpen] = useState(false);
  // The chat's "+" menu opens the same modal through this event.
  useEffect(() => {
    const onOpen = () => setIntegrationsOpen(true);
    window.addEventListener(OPEN_INTEGRATIONS_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_INTEGRATIONS_EVENT, onOpen);
  }, []);
  const [feedbackPrefill, setFeedbackPrefill] = useState<FeedbackPrefill | null>(null);
  // Active paid plan shown in the credits pill; stays empty without one.
  const [planName, setPlanName] = useState("");
  const signedIn = Boolean(user);
  useEffect(() => {
    if (!signedIn) return;
    const controller = new AbortController();
    fetch("/api/subscriptions", { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { subscription?: { planName: string; status: string } | null } | null) => setPlanName(payload?.subscription?.status === "authorized" ? payload.subscription.planName : ""))
      .catch(() => undefined);
    return () => controller.abort();
  }, [signedIn]);

  useEffect(() => {
    const onOpen = (event: Event) => {
      setFeedbackPrefill((event as CustomEvent<FeedbackPrefill>).detail ?? null);
      setFeedbackOpen(true);
    };
    window.addEventListener(OPEN_FEEDBACK_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_FEEDBACK_EVENT, onOpen);
  }, []);
  const account = usePopover({ menu: true });
  const setAccountOpen = account.setOpen;
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !navRef.current?.contains(event.target)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => { hydrated = true; }, []);

  function toggleCollapsed() {
    setAccountOpen(false);
    writeCollapsed(!readCollapsed());
  }

  // Ctrl+B / Cmd+B toggles the rail, except while typing.
  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== "b" || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      toggleCollapsed();
    }
    document.addEventListener("keydown", handleShortcut);
    return () => document.removeEventListener("keydown", handleShortcut);
  }, []);

  const close = () => { setOpen(false); setAccountOpen(false); };
  const isCollapsed = collapsed === true;
  const tip = (label: string) => (isCollapsed ? label : undefined);

  return (
    <>
      {renderBoot && <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />}
      <nav className="side-nav" id="side-nav" ref={navRef} data-open={open} data-collapsed={collapsed === null ? undefined : String(collapsed)} aria-label={s("mainNav")}>
        <div className="side-nav-head">
          <BrandLogo />
          <Link className="side-nav-mark" href="/" aria-label={s("homeLabel")}><BrandMark /></Link>
          <button
            type="button"
            className="side-nav-collapse"
            aria-expanded={!isCollapsed}
            aria-controls="side-nav-panel"
            aria-label={isCollapsed ? s("expandSidebar") : s("collapseSidebar")}
            title={`${isCollapsed ? s("expandSidebar") : s("collapseSidebar")} (Ctrl+B)`}
            onClick={toggleCollapsed}
          >
            {isCollapsed ? <PanelLeftOpen size={18} strokeWidth={1.8} aria-hidden="true" /> : <PanelLeftClose size={18} strokeWidth={1.8} aria-hidden="true" />}
          </button>
          <button
            type="button"
            className="side-nav-toggle"
            aria-expanded={open}
            aria-controls="side-nav-panel"
            aria-label={open ? s("closeMenu") : s("openMenu")}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X size={20} strokeWidth={1.8} aria-hidden="true" /> : <Menu size={20} strokeWidth={1.8} aria-hidden="true" />}
          </button>
        </div>
        <div className="side-nav-panel" id="side-nav-panel">
          <BusinessSwitcher tip={tip} onNavigate={close} />
          <div className="side-nav-account">
            {user ? (
              <button {...account.triggerProps} type="button" className="side-nav-account-trigger" aria-haspopup="menu" title={user.email}>
                <span className="connection-dot" aria-hidden="true" />
                <span className="side-nav-avatar" aria-hidden="true">{user.email.charAt(0).toUpperCase()}</span>
                <span className="profile-email">{user.email}</span>
                <ChevronDown className="side-nav-account-chevron" size={16} strokeWidth={1.8} aria-hidden="true" />
              </button>
            ) : <span className="side-nav-account-trigger side-nav-skeleton" aria-hidden="true" />}
            {user && (
              <Popover {...account.popoverProps} role="menu" placement="bottom-start" matchAnchorWidth className="side-nav-account-menu" aria-label={user.email}>
                <Link role="menuitem" className="side-nav-item" href="/historial" aria-current={active === "history" ? "page" : undefined} onClick={close}>
                  <History className="menu-icon" size={18} strokeWidth={1.8} aria-hidden="true" />
                  <span>{t("t_302027905c")}</span>
                </Link>
                <button type="button" role="menuitem" className="side-nav-item" aria-haspopup="dialog" aria-current={active === "integrations" ? "page" : undefined} onClick={() => { close(); setIntegrationsOpen(true); }}>
                  <Plug className="menu-icon" size={18} strokeWidth={1.8} aria-hidden="true" />
                  <span>{s("navIntegrations")}</span>
                </button>
                <a role="menuitem" className="side-nav-item" href={`https://wa.me/${LEADTA_WHATSAPP}?text=${encodeURIComponent(s("salesSupportMessage"))}`} target="_blank" rel="noopener noreferrer" onClick={close}>
                  <Headset className="menu-icon" size={18} strokeWidth={1.8} aria-hidden="true" />
                  <span>{s("salesSupport")}</span>
                </a>
              </Popover>
            )}
          </div>
          <ul className="side-nav-list">
            <li>
              {user ? (
              <Link className="side-nav-item side-nav-credits" href="/pricing" aria-label={s("creditsAria", { credits: user.credits })} title={s("creditsTitle")} onClick={close}>
                <Stars className="menu-icon" size={18} strokeWidth={1.8} aria-hidden="true" />
                <span className="side-nav-credits-value"><strong>{user.credits.toLocaleString(locale === "es" ? "es-AR" : "en-US")}</strong> {t("t_bcc0da40b3")}</span>
                {planName ? <span className="shrink-0 rounded-full bg-(--ash-950) px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-(--lime)">{planName}</span> : null}
                <span className="credits-add-sign" aria-hidden="true">+</span>
              </Link>
              ) : <span className="side-nav-item side-nav-credits side-nav-skeleton" aria-hidden="true" />}
            </li>
            <li>
              {/* Leadtita: first and featured (lime icon chip + "New" text tag, so it doesn't rely on color alone). */}
              <Link title={tip(s("navLeadtita"))} className="side-nav-item side-nav-featured" href="/leadtita" aria-current={active === "leadtita" ? "page" : undefined} onClick={close}>
                <span className="side-nav-chip" aria-hidden="true"><Sparkles size={16} strokeWidth={2} /></span>
                <span className="side-nav-featured-label">{s("navLeadtita")}</span>
                <span className="side-nav-new">{s("navNewBadge")}</span>
              </Link>
            </li>
            <li>
              <Link title={tip(s("navLeadSuite"))} className="side-nav-item" href="/lead-suite" aria-current={active === "leadSuite" ? "page" : undefined} onClick={close}>
                <LayoutDashboard className="menu-icon" size={18} strokeWidth={1.8} aria-hidden="true" />
                <span>{s("navLeadSuite")}</span>
              </Link>
            </li>
            {WORKSPACE_NAV.map(({ key, href, label, Icon }) => (
              <li key={key}>
                <Link title={tip(s(label))} className="side-nav-item" href={href} aria-current={active === key ? "page" : undefined} onClick={close}>
                  <Icon className="menu-icon" size={18} strokeWidth={1.8} aria-hidden="true" />
                  <span>{s(label)}</span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="side-nav-bottom">
            {isOwner && (
              <Link title={tip(s("navOwnerPanel"))} className="side-nav-item" href="/owner" onClick={close}>
                <ShieldCheck className="menu-icon" size={18} strokeWidth={1.8} aria-hidden="true" />
                <span>{s("navOwnerPanel")}</span>
              </Link>
            )}
            <button type="button" title={tip(s("feedback"))} className="side-nav-item side-nav-feedback" aria-haspopup="dialog" onClick={() => { close(); setFeedbackOpen(true); }}>
              <MessageSquare className="menu-icon" size={18} strokeWidth={1.8} aria-hidden="true" />
              <span>{s("feedback")}</span>
            </button>
            <div className="side-nav-foot">
              <LanguageSwitcher placement="top-start" />
              <button type="button" title={tip(t("t_f394d0254e"))} className="side-nav-item side-nav-signout" onClick={() => { close(); writeBusinessCache(null); void onSignOut(); }}>
                <LogOut className="menu-icon signout-icon" size={18} strokeWidth={1.8} aria-hidden="true" />
                <span>{t("t_f394d0254e")}</span>
              </button>
            </div>
          </div>
        </div>
      </nav>
      <FeedbackDialog open={feedbackOpen} prefill={feedbackPrefill} onClose={() => setFeedbackOpen(false)} />
      <IntegrationsDialog open={integrationsOpen} onClose={() => setIntegrationsOpen(false)} returnTo={active === "leadtita" ? "/leadtita" : "/integraciones"} />
      {/* Not on /leadtita: the CTA points there and new users get the Leadtita tour on that page. */}
    </>
  );
}
