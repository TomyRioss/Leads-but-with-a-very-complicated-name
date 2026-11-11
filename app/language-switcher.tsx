"use client";

import { useLocale, useTranslations } from "next-intl";

export function LanguageSwitcher() {
  const locale = useLocale();
  const t = useTranslations("LanguageSwitcher");
  const nextLocale = locale === "es" ? "en" : "es";

  return (
    <button
      className="language-switcher"
      type="button"
      onClick={() => {
        const url = new URL(window.location.href);
        document.cookie = `NEXT_LOCALE=${nextLocale}; Path=/; Max-Age=31536000; SameSite=Lax`;
        const parts = url.pathname.split("/").filter(Boolean);
        if (parts[0] === "en" || parts[0] === "es") parts.shift();
        url.pathname = nextLocale === "en" ? `/en/${parts.join("/")}`.replace(/\/$/, "") : `/${parts.join("/")}`;
        window.location.assign(url);
      }}
      aria-label={t("label")}
      title={t("title")}
    >
      <span aria-hidden="true">{locale === "es" ? "🇪🇸" : "🇺🇸"}</span>
      <span>{locale.toUpperCase()}</span>
    </button>
  );
}
