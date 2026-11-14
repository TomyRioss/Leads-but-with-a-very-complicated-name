"use client";

import { useLocale, useTranslations } from "next-intl";
import { Check, ChevronDown } from "lucide-react";
import { Popover, usePopover, type Placement } from "@/app/ui/popover";
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

/** `placement`: bottom-end in top bars, top-start in the sidebar footer. */
export function LanguageSwitcher({ placement = "bottom-end" }: { placement?: Placement }) {
  const locale = useLocale();
  const t = useTranslations("LanguageSwitcher");
  const menu = usePopover({ menu: true });

  return (
    <div className="language-switcher">
      <button
        {...menu.triggerProps}
        type="button"
        className="language-trigger"
        aria-haspopup="listbox"
        aria-label={t("label")}
        title={t("title")}
      >
        <Flag locale={locale} />
        <span className="language-code" aria-hidden="true">{locale.toUpperCase()}</span>
        <ChevronDown className="language-chevron" size={16} strokeWidth={1.8} aria-hidden="true" />
      </button>
      <Popover {...menu.popoverProps} role="listbox" placement={placement} className="language-menu" aria-label={t("label")}>
        {LOCALES.map((item) => (
          <button
            key={item.value}
            type="button"
            role="option"
            aria-selected={item.value === locale}
            className="language-option"
            onClick={() => (item.value === locale ? menu.close() : switchLocale(item.value))}
          >
            <Flag locale={item.value} />
            <span className="language-option-name">{item.name}</span>
            {item.value === locale && <Check className="language-option-check" size={16} strokeWidth={2} aria-hidden="true" />}
          </button>
        ))}
      </Popover>
    </div>
  );
}
