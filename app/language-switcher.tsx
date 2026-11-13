"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, ChevronDown } from "lucide-react";
import "./language-switcher.css";

const LOCALES = [
  { value: "es", name: "Español" },
  { value: "en", name: "English" },
] as const;

function Flag({ locale }: { locale: string }) {
  return (
    <span className={`language-flag language-flag-${locale}`} aria-hidden="true">
      {locale === "en" && <span className="language-flag-canton" />}
    </span>
  );
}

function switchLocale(nextLocale: string) {
  const url = new URL(window.location.href);
  document.cookie = `NEXT_LOCALE=${nextLocale}; Path=/; Max-Age=31536000; SameSite=Lax`;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] === "en" || parts[0] === "es") parts.shift();
  url.pathname = nextLocale === "en" ? `/en/${parts.join("/")}`.replace(/\/$/, "") : `/${parts.join("/")}`;
  window.location.assign(url);
}

export function LanguageSwitcher() {
  const locale = useLocale();
  const t = useTranslations("LanguageSwitcher");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!open) return;
    optionRefs.current[Math.max(0, LOCALES.findIndex((l) => l.value === locale))]?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, locale]);

  function onMenuKeyDown(event: React.KeyboardEvent) {
    const items = optionRefs.current;
    const current = items.findIndex((el) => el === document.activeElement);
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      items[(current + step + items.length) % items.length]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      items[event.key === "Home" ? 0 : items.length - 1]?.focus();
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div className="language-switcher" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="language-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("label")}
        title={t("title")}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Flag locale={locale} />
        <span className="language-code" aria-hidden="true">{locale.toUpperCase()}</span>
        <ChevronDown className="language-chevron" size={16} strokeWidth={1.8} aria-hidden="true" />
      </button>
      {open && (
        <ul className="language-menu" role="listbox" aria-label={t("label")} onKeyDown={onMenuKeyDown}>
          {LOCALES.map((item, index) => (
            <li key={item.value} role="presentation">
              <button
                ref={(el) => { optionRefs.current[index] = el; }}
                type="button"
                role="option"
                aria-selected={item.value === locale}
                className="language-option"
                onClick={() => (item.value === locale ? (setOpen(false), triggerRef.current?.focus()) : switchLocale(item.value))}
              >
                <Flag locale={item.value} />
                <span className="language-option-name">{item.name}</span>
                {item.value === locale && <Check className="language-option-check" size={16} strokeWidth={2} aria-hidden="true" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
