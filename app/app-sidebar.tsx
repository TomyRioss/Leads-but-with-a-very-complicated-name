"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Gift, Headset, History, LogOut, Menu, Search, Stars, X } from "lucide-react";
import { BrandLogo } from "@/app/brand-logo";
import { LanguageSwitcher } from "@/app/language-switcher";
import { ReferralDialog } from "@/app/referral-dialog";
import { Link } from "@/i18n/navigation";

type AppSidebarProps = {
  active: "search" | "history";
  user: { email: string; credits: number };
  onSignOut: () => void | Promise<void>;
};

/** Sidebar único de la app con sesión: colapsa en móvil, cierra con Escape o clic fuera. Incluye el diálogo de referidos. */
export function AppSidebar({ active, user, onSignOut }: AppSidebarProps) {
  const t = useTranslations("UI");
  const s = useTranslations("Search");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [referralOpen, setReferralOpen] = useState(false);
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

  const close = () => setOpen(false);

  return (
    <>
      <nav className="side-nav" id="side-nav" ref={navRef} data-open={open} aria-label={s("mainNav")}>
        <div className="side-nav-head">
          <BrandLogo />
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
          <ul className="side-nav-list">
            <li>
              <Link className="side-nav-item side-nav-credits" href="/pricing" aria-label={s("creditsAria", { credits: user.credits })} title={s("creditsTitle")} onClick={close}>
                <Stars className="menu-icon" size={18} strokeWidth={1.8} aria-hidden="true" />
                <span className="side-nav-credits-value"><strong>{user.credits.toLocaleString(locale === "es" ? "es-AR" : "en-US")}</strong> {t("t_bcc0da40b3")}</span>
                <span className="credits-add-sign" aria-hidden="true">+</span>
              </Link>
            </li>
            <li>
              <Link className="side-nav-item" href="/buscar" aria-current={active === "search" ? "page" : undefined} onClick={close}>
                <Search className="menu-icon" size={18} strokeWidth={1.8} aria-hidden="true" />
                <span>{s("navSearch")}</span>
              </Link>
            </li>
            <li>
              <Link className="side-nav-item" href="/historial" aria-current={active === "history" ? "page" : undefined} onClick={close}>
                <History className="menu-icon" size={18} strokeWidth={1.8} aria-hidden="true" />
                <span>{t("t_302027905c")}</span>
              </Link>
            </li>
            {process.env.NODE_ENV === "development" && (
              <li>
                <button type="button" className="side-nav-item" aria-haspopup="dialog" onClick={() => { close(); setReferralOpen(true); }}>
                  <Gift className="menu-icon" size={18} strokeWidth={1.8} aria-hidden="true" />
                  <span>{s("recommendLeadta")}</span>
                </button>
              </li>
            )}
            <li>
              <a className="side-nav-item" href={`https://wa.me/5491134083140?text=${encodeURIComponent(s("salesSupportMessage"))}`} target="_blank" rel="noopener noreferrer" onClick={close}>
                <Headset className="menu-icon" size={18} strokeWidth={1.8} aria-hidden="true" />
                <span>{s("salesSupport")}</span>
              </a>
            </li>
          </ul>
          <div className="side-nav-foot">
            <LanguageSwitcher />
            <p className="side-nav-account"><span className="connection-dot" aria-hidden="true" /><span className="profile-email" title={user.email}>{user.email}</span></p>
            <button type="button" className="side-nav-item side-nav-signout" onClick={() => { close(); void onSignOut(); }}>
              <LogOut className="menu-icon signout-icon" size={18} strokeWidth={1.8} aria-hidden="true" />
              <span>{t("t_f394d0254e")}</span>
            </button>
          </div>
        </div>
      </nav>
      <ReferralDialog open={referralOpen} onClose={() => setReferralOpen(false)} />
    </>
  );
}
