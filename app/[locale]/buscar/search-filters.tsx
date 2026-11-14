"use client";

import { memo, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, Globe, Mail, MessageSquareText, Phone, RotateCcw, SlidersHorizontal, Star } from "lucide-react";

export type FilterChoice = "any" | "with" | "without";
export type SearchFilters = {
  minReviews: string;
  minRating: string;
  website: FilterChoice;
  phone: FilterChoice;
  email: FilterChoice;
  skipClosed: boolean;
};
export const defaultSearchFilters: SearchFilters = { minReviews: "", minRating: "", website: "any", phone: "any", email: "any", skipClosed: false };

type Option = { value: string; label: string };

/** Grupo de opciones de un solo toque: radios nativos (teclado con flechas, lector de pantalla) con aspecto de segmentos. */
function ChoiceGroup({ name, label, icon, options, value, onChange, disabled }: {
  name: string;
  label: string;
  icon: ReactNode;
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="filter-choice" disabled={disabled}>
      <legend className="filter-choice-label">{icon}{label}</legend>
      <div className="filter-segments">
        {options.map((option) => (
          <label key={option.value} className={`filter-segment${value === option.value ? " is-selected" : ""}`}>
            <input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export const SearchFiltersPanel = memo(function SearchFiltersPanel({ filters, setFilters, disabled }: {
  filters: SearchFilters;
  setFilters: Dispatch<SetStateAction<SearchFilters>>;
  disabled?: boolean;
}) {
  const t = useTranslations("UI");
  const s = useTranslations("Search");
  const set = <K extends keyof SearchFilters>(key: K) => (value: SearchFilters[K]) => setFilters((current) => ({ ...current, [key]: value }));

  const reviewOptions: Option[] = [
    { value: "", label: t("t_1aa3b744db") }, { value: "10", label: "10+" }, { value: "50", label: "50+" }, { value: "100", label: "100+" }, { value: "500", label: "500+" },
  ];
  const ratingOptions: Option[] = [
    { value: "", label: t("t_1aa3b744db") }, { value: "3", label: "3+" }, { value: "4", label: "4+" }, { value: "4.5", label: s("ratingFourHalf") },
  ];
  const presenceOptions: Option[] = [
    { value: "any", label: s("filtersAny") }, { value: "with", label: s("filtersWith") }, { value: "without", label: s("filtersWithout") },
  ];

  // Resumen visible con el panel cerrado: qué filtros recortan el lote.
  const presence = { with: { website: t("t_139ef9d2c1"), email: t("t_3014233e51"), phone: t("t_86fc9079fb") }, without: { website: t("t_fcfe9b7823"), email: t("t_b1f7ce3fe3"), phone: t("t_5a107669e1") } };
  const active = [
    filters.minReviews && s("filtersReviewsChip", { count: filters.minReviews }),
    filters.minRating && s("filtersRatingChip", { rating: filters.minRating.replace(".", s("decimalSeparator")) }),
    ...(["website", "email", "phone"] as const).map((key) => filters[key] !== "any" && presence[filters[key] as "with" | "without"][key]),
    filters.skipClosed && s("filtersOpenOnly"),
  ].filter((item): item is string => Boolean(item));

  return (
    <details className="filter-panel">
      <summary>
        <span className="filter-summary-icon" aria-hidden="true"><SlidersHorizontal size={16} strokeWidth={1.9} /></span>
        <span className="filter-summary-text">
          <span className="filter-summary-title">
            {t("t_dc3b882450")}
            {active.length > 0 && <span className="filter-count">{s("filtersActive", { count: active.length })}</span>}
          </span>
          <span className="filter-summary-hint">{active.length ? active.join(" · ") : s("filtersHint")}</span>
        </span>
        <ChevronDown className="filter-summary-chevron" size={18} strokeWidth={1.8} aria-hidden="true" />
      </summary>

      <div className="filter-body">
        <section className="filter-group" aria-labelledby="filter-group-reputation">
          <h3 id="filter-group-reputation" className="filter-group-title">{s("filtersReputation")}</h3>
          <ChoiceGroup name="filter-reviews" label={t("t_44fdec749a")} icon={<MessageSquareText size={15} strokeWidth={1.8} aria-hidden="true" />} options={reviewOptions} value={filters.minReviews} onChange={set("minReviews")} disabled={disabled} />
          <ChoiceGroup name="filter-rating" label={t("t_c323da7d69")} icon={<Star size={15} strokeWidth={1.8} aria-hidden="true" />} options={ratingOptions} value={filters.minRating} onChange={set("minRating")} disabled={disabled} />
        </section>

        <section className="filter-group" aria-labelledby="filter-group-contact">
          <h3 id="filter-group-contact" className="filter-group-title">{s("filtersContact")}</h3>
          <ChoiceGroup name="filter-website" label={t("t_e3fd0b8e08")} icon={<Globe size={15} strokeWidth={1.8} aria-hidden="true" />} options={presenceOptions} value={filters.website} onChange={(value) => set("website")(value as FilterChoice)} disabled={disabled} />
          <ChoiceGroup name="filter-email" label={t("t_84add5b295")} icon={<Mail size={15} strokeWidth={1.8} aria-hidden="true" />} options={presenceOptions} value={filters.email} onChange={(value) => set("email")(value as FilterChoice)} disabled={disabled} />
          {filters.email === "without" && <p className="field-help filter-note">{t("t_c7d6c48ff2")}</p>}
          <ChoiceGroup name="filter-phone" label={t("t_99af3763e0")} icon={<Phone size={15} strokeWidth={1.8} aria-hidden="true" />} options={presenceOptions} value={filters.phone} onChange={(value) => set("phone")(value as FilterChoice)} disabled={disabled} />
        </section>

        <div className="filter-footer">
          <label className="full-data-toggle">
            <input type="checkbox" role="switch" checked={filters.skipClosed} onChange={(event) => set("skipClosed")(event.target.checked)} disabled={disabled} />
            <span className="full-data-track" aria-hidden="true" />
            <span>{t("t_d969b6207f")}</span>
          </label>
          <button type="button" className="filter-clear" onClick={() => setFilters(defaultSearchFilters)} disabled={disabled || active.length === 0}>
            <RotateCcw size={14} strokeWidth={1.9} aria-hidden="true" /> {s("filtersClear")}
          </button>
        </div>
      </div>
    </details>
  );
});
