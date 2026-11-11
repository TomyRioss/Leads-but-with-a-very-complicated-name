"use client";

import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { CreditCard, LayoutDashboard, LoaderCircle, LogOut, Menu, Receipt, RefreshCw, ScrollText, Search, Users, X } from "lucide-react";
import { BrandLogo } from "@/app/brand-logo";
import { LanguageSwitcher } from "@/app/language-switcher";
import { ghostButton, iconButton, isUnauthorized, ownerFetch, stateBox, useFocusTrap, type OnAction } from "./ui";

export type OwnerSectionKey = "resumen" | "usuarios" | "suscripciones" | "pagos" | "busquedas" | "auditoria";

const navItems: { key: OwnerSectionKey; label: string; icon: ComponentType<{ size?: number; "aria-hidden"?: boolean }> }[] = [
  { key: "resumen", label: "navSummary", icon: LayoutDashboard },
  { key: "usuarios", label: "navUsers", icon: Users },
  { key: "suscripciones", label: "navSubscriptions", icon: CreditCard },
  { key: "pagos", label: "navPayments", icon: Receipt },
  { key: "busquedas", label: "navSearches", icon: Search },
  { key: "auditoria", label: "navAudit", icon: ScrollText },
];

const loading = () => {
  const t = useTranslations("UI");
  return <p className={stateBox} role="status"><LoaderCircle className="animate-spin" size={16} aria-hidden="true" /> {t("t_6b416d9c40")}</p>;
};
// Each section is only loaded (and only requests its data) while it is the active one.
const Overview = dynamic(() => import("./sections/overview-section"), { loading });
const UsersSection = dynamic(() => import("./sections/users-section"), { loading });
const SubscriptionsSection = dynamic(() => import("./sections/subscriptions-section"), { loading });
const PaymentsSection = dynamic(() => import("./sections/payments-section"), { loading });
const SearchesSection = dynamic(() => import("./sections/searches-section"), { loading });
const AuditSection = dynamic(() => import("./sections/audit-section"), { loading });

const sectionKeys = navItems.map((item) => item.key);

export default function OwnerPanel() {
  const t = useTranslations("UI");
  const requested = useSearchParams().get("s");
  const initialSection = sectionKeys.find((key) => key === requested) ?? "resumen";
  const [auth, setAuth] = useState<"loading" | "owner" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const [section, setSection] = useState<OwnerSectionKey>(initialSection);
  const [email, setEmail] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const router = useRouter();
  const sidebarRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const mainRef = useRef<HTMLElement>(null);

  // Without an owner session there is nothing to show here: send the user back to the app.
  const leavePanel = useCallback(() => router.replace("/buscar"), [router]);

  useEffect(() => {
    let active = true;
    ownerFetch("/api/owner/me").then((result) => {
      if (!active) return;
      if (result.ok) setAuth("owner");
      else if (isUnauthorized(result.status)) leavePanel();
      else setAuth("error");
    });
    return () => { active = false; };
  }, [attempt, leavePanel]);

  useEffect(() => {
    if (auth !== "owner") return;
    let active = true;
    ownerFetch<{ user?: { email?: string } | null }>("/api/auth/me").then((result) => {
      if (active && result.ok) setEmail(result.data.user?.email ?? "");
    });
    return () => { active = false; };
  }, [auth]);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    menuButtonRef.current?.focus();
  }, []);
  useFocusTrap(sidebarRef, menuOpen, closeMenu);
  useEffect(() => {
    if (menuOpen) sidebarRef.current?.querySelector<HTMLElement>("a, button")?.focus();
  }, [menuOpen]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 10_000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function go(next: OwnerSectionKey) {
    setMenuOpen(false);
    setSection(next);
    router.replace(`/owner?s=${next}`, { scroll: false });
    window.scrollTo(0, 0);
    mainRef.current?.focus({ preventScroll: true });
  }

  const onAction: OnAction = useCallback((text) => setToast({ id: Date.now(), text }), []);

  function retry() {
    setAuth("loading");
    setAttempt((value) => value + 1);
  }

  async function logout() {
    await ownerFetch("/api/auth/logout", { method: "POST" });
    leavePanel();
  }

  const sidebarOpen = menuOpen ? "max-md:visible max-md:translate-x-0" : "max-md:invisible max-md:-translate-x-full";
  const current = navItems.find((item) => item.key === section) ?? navItems[0];

  if (auth !== "owner") {
    return (
      <main className="grid min-h-dvh place-items-center bg-(--ash-100) text-(color:--ink)">
        {auth === "loading" && <p className={stateBox} role="status"><LoaderCircle className="animate-spin" size={16} aria-hidden="true" /> {t("t_6b416d9c40")}</p>}
        {auth === "error" && (
          <div className={`${stateBox} flex-wrap justify-center`} role="alert">
            <span>{t("t_fa109442e0")}</span>
            <button className={ghostButton} type="button" onClick={retry}><RefreshCw size={15} aria-hidden="true" /> {t("t_adec7b4f23")}</button>
          </div>
        )}
      </main>
    );
  }

  return (
    <div className="min-h-dvh bg-(--ash-100) text-(color:--ink) md:grid md:grid-cols-[232px_minmax(0,1fr)]">
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-(color:--line) bg-(--paper) px-4 py-3 md:hidden">
        <button ref={menuButtonRef} className={iconButton} type="button" onClick={() => setMenuOpen(true)} aria-label="Abrir menú" aria-expanded={menuOpen} aria-controls="owner-sidebar"><Menu size={18} aria-hidden="true" /></button>
        <span className="text-sm font-semibold">{t(current.label)}</span>
        <LanguageSwitcher />
        <span className="ml-auto rounded-full bg-(--ash-950) px-2 py-[3px] text-[10px] font-bold uppercase tracking-wider text-(color:--lime)">{t("t_89ff31225c")}</span>
      </header>

      {menuOpen && <div className="fixed inset-0 z-40 bg-(--ash-950)/45 md:hidden" onMouseDown={closeMenu} aria-hidden="true" />}

      <aside
        id="owner-sidebar"
        ref={sidebarRef}
        className={`fixed inset-y-0 left-0 z-50 flex w-58 flex-col gap-5 border-r border-(color:--line) bg-(--paper) p-4 transition-transform md:sticky md:top-0 md:z-auto md:h-dvh md:w-auto md:translate-x-0 md:visible ${sidebarOpen}`}
        aria-label="Panel owner"
      >
        <div className="flex items-center gap-2.5">
          <BrandLogo />
          <LanguageSwitcher />
          <span className="rounded-full bg-(--ash-950) px-2 py-[3px] text-[10px] font-bold uppercase tracking-wider text-(color:--lime)">{t("t_89ff31225c")}</span>
          <button className={`${iconButton} ml-auto md:hidden`} type="button" onClick={closeMenu} aria-label="Cerrar menú"><X size={18} aria-hidden="true" /></button>
        </div>

        <nav aria-label="Secciones del panel" className="grid gap-1">
          {navItems.map(({ key, label, icon: Icon }) => {
            const active = key === section;
            return (
              <button
                key={key}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => go(key)}
                className={`flex min-h-10 cursor-pointer items-center gap-2.5 rounded-lg border-0 px-3 text-left text-[13px]! font-semibold! focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(color:--ash-950) ${active ? "bg-(--ash-950) text-(color:--paper)! hover:bg-(--ash-900)" : "bg-transparent text-(color:--ash-800)! hover:bg-(--ash-100)"}`}
              >
                <Icon size={16} aria-hidden={true} />
                {t(label)}
              </button>
            );
          })}
        </nav>

        <div className="mt-auto grid gap-2 border-t border-(color:--line) pt-3">
          {email && <p className="m-0 break-all text-[11px] text-(color:--muted)" title={email}>{email}</p>}
          <button className={ghostButton} type="button" onClick={() => void logout()}><LogOut size={15} aria-hidden="true" /> {t("t_e089c6496b")}</button>
        </div>
      </aside>

      <main ref={mainRef} tabIndex={-1} className="min-w-0 outline-none">
        <div className="mx-auto w-[calc(100%-32px)] max-w-[1160px] pb-20 pt-5 md:pt-8">
          {section === "resumen" && <Overview onUnauthorized={leavePanel} onOpenAudit={() => go("auditoria")} />}
          {section === "usuarios" && <UsersSection onUnauthorized={leavePanel} onAction={onAction} />}
          {section === "suscripciones" && <SubscriptionsSection onUnauthorized={leavePanel} onAction={onAction} />}
          {section === "pagos" && <PaymentsSection onUnauthorized={leavePanel} />}
          {section === "busquedas" && <SearchesSection onUnauthorized={leavePanel} onAction={onAction} />}
          {section === "auditoria" && <AuditSection onUnauthorized={leavePanel} />}
        </div>
      </main>

      <div className="pointer-events-none fixed inset-x-4 bottom-4 z-60 flex justify-end" aria-live="polite">
        {toast && (
          <div className="pointer-events-auto flex max-w-md items-center gap-3 rounded-[10px] border border-(color:--ash-950) bg-(--paper) px-4 py-3 text-xs shadow-lg" role="status">
            <span className="font-semibold">{toast.text}</span>
            {section !== "auditoria" && <button className="cursor-pointer whitespace-nowrap rounded border-0 bg-transparent p-1 text-xs font-semibold underline underline-offset-[3px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(color:--ash-950)" type="button" onClick={() => { setToast(null); go("auditoria"); }}>{t("t_12a19d95bf")}</button>}
            <button className="cursor-pointer rounded border-0 bg-transparent p-1 text-(color:--muted) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(color:--ash-950)" type="button" onClick={() => setToast(null)} aria-label="Cerrar aviso"><X size={14} aria-hidden="true" /></button>
          </div>
        )}
      </div>
    </div>
  );
}
