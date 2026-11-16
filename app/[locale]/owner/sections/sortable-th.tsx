"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { rightCell, thClass, type ListSort } from "../ui";

/**
 * Column header that toggles the list sort (`column` asc / `-column` desc). Use inside a `sortTheadClass` thead.
 * First click: descending for numbers and dates, ascending for text; the next click flips it.
 */
export function SortableTh({ label, column, sort, onSort, kind = "text", className = "" }: {
  label: string;
  column: string;
  sort: ListSort;
  onSort: (value: ListSort) => void;
  kind?: "text" | "number" | "date";
  className?: string;
}) {
  const t = useTranslations("Owner.common");
  const desc = sort === `-${column}`;
  const active = desc || sort === column;
  const numeric = kind === "number";
  const next = active ? (desc ? column : `-${column}`) : kind === "text" ? column : `-${column}`;
  const Icon = !active ? ArrowUpDown : desc ? ArrowDown : ArrowUp;
  const name = active
    ? t("sortActive", { column: label, direction: desc ? t("sortDescending") : t("sortAscending") })
    : t("sortBy", { column: label });

  return (
    <th className={`${thClass}${numeric ? ` ${rightCell}` : ""} max-md:border-0 max-md:p-0 ${className}`} scope="col" aria-sort={active ? (desc ? "descending" : "ascending") : "none"}>
      <button
        type="button"
        aria-label={name}
        onClick={() => onSort(next)}
        className={`group -mx-1 inline-flex cursor-pointer items-center gap-1 rounded-md px-1 py-0.5 font-semibold hover:text-(color:--ink) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(color:--ash-950) max-md:mx-0 max-md:min-h-9 max-md:rounded-full max-md:border max-md:px-3 ${numeric ? "flex-row-reverse" : ""} ${
          active ? "text-(color:--ink) max-md:border-(color:--ash-950) max-md:bg-(--ash-950) max-md:text-(color:--lime)!" : "max-md:border-(color:--ash-300) max-md:bg-(--paper)"
        }`}
      >
        {label}
        <Icon size={12} strokeWidth={2.25} aria-hidden="true" className={active ? "shrink-0" : "shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 max-md:opacity-60"} />
      </button>
    </th>
  );
}
