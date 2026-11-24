"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChevronDown, Headset, History, LayoutDashboard, LogOut, Menu, MessageSquare, Plug, PanelLeftClose, PanelLeftOpen, Search, ShieldCheck, Sparkles, Stars, UserSearch, X } from "lucide-react";
import { BrandLogo, BrandMark } from "@/app/brand-logo";
import { LanguageSwitcher } from "@/app/language-switcher";
import { FeedbackDialog } from "@/app/feedback-dialog";
import { IntegrationsDialog, OPEN_INTEGRATIONS_EVENT } from "@/app/integrations-dialog";
import { OPEN_FEEDBACK_EVENT, type FeedbackPrefill } from "@/app/error-report";
import { WhatsNewDialog } from "@/app/whats-new-dialog";
import { getSession } from "@/lib/client/session";
import { Link } from "@/i18n/navigation";
import { Popover, usePopover } from "@/app/ui/popover";

type AppSidebarProps = {
  active: "search" | "history" | "leadSuite" | "people" | "leadtita" | "integrations";
  /** null while the session loads: renders a same-size skeleton for account and credits. */
  user: { email: string; credits: number } | null;
  onSignOut: () => void | Promise<void>;
  /** false holds the WhatsApp + Gmail announcement (e.g. /buscar until it knows the user won't be redirected). */
  announce?: boolean;
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

type EnvFlags = { devFeatures: string[] };
const PROD_FLAGS: EnvFlags = { devFeatures: [] };
// ponytail: one /api/status request per page load, shared by every sidebar mount.
let envFlagsRequest: Promise<EnvFlags> | null = null;
function loadEnvFlags() {
  envFlagsRequest ??= fetch("/api/status", { cache: "no-store" })
    .then((response) => response.json())
    .then((status) => ({ devFeatures: Array.isArray(status.devFeatures) ? status.devFeatures : [] }))
    .catch(() => PROD_FLAGS);
  return envFlagsRequest;
}

/** Sidebar único de la app con sesión: colapsa en móvil, cierra con Escape o clic fuera. */
export function AppSidebar({ active, user, onSignOut, announce = true }: AppSidebarProps) {
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
  const [envFlags, setEnvFlags] = useState<EnvFlags>(PROD_FLAGS);
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
    let current = true;
    void loadEnvFlags().then((flags) => { if (current) setEnvFlags(flags); });
    return () => { current = false; };
  }, []);

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
                <a role="menuitem" className="side-nav-item" href={`https://wa.me/5491134083140?text=${encodeURIComponent(s("salesSupportMessage"))}`} target="_blank" rel="noopener noreferrer" onClick={close}>
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
            <li>
              <Link title={tip(s("navSearch"))} className="side-nav-item" href="/buscar" aria-current={active === "search" ? "page" : undefined} onClick={close}>
                <Search className="menu-icon" size={18} strokeWidth={1.8} aria-hidden="true" />
                <span>{s("navSearch")}</span>
              </Link>
            </li>
            {envFlags.devFeatures.includes("people_search") && <li>
              <Link title={tip(s("navPeople"))} className="side-nav-item" href="/personas" aria-current={active === "people" ? "page" : undefined} onClick={close}>
                <UserSearch className="menu-icon" size={18} strokeWidth={1.8} aria-hidden="true" />
                <span>{s("navPeople")}</span>
              </Link>
            </li>}
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
              <button type="button" title={tip(t("t_f394d0254e"))} className="side-nav-item side-nav-signout" onClick={() => { close(); void onSignOut(); }}>
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
      <WhatsNewDialog email={!announce || active === "leadtita" ? null : user?.email ?? null} />
    </>
  );
}
