"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { iconButton, statusPill, useFocusTrap } from "../ui";

export type DetailChip = { label: string; status: string };
export type DetailExcerpt = { label: string; text: string };

/** Simple accessible modal: title, optional subtitle, status chips, excerpts and a label/value list. Esc and backdrop close it. */
export function DetailDialog({ title, subtitle, rows, chips, excerpts, closeLabel, onClose }: {
  title: string;
  subtitle?: string;
  rows: [string, string][];
  chips?: DetailChip[];
  excerpts?: DetailExcerpt[];
  closeLabel: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useFocusTrap(ref, true, onClose);
  useEffect(() => { closeRef.current?.focus(); }, []);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-(--ash-950)/45 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className="grid max-h-[calc(100dvh-32px)] w-full max-w-xl content-start gap-4 overflow-y-auto rounded-[10px] border border-(color:--line) bg-(--paper) p-5 max-sm:p-4">
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="m-0 text-[17px] font-semibold leading-snug tracking-tight text-balance [overflow-wrap:anywhere]">{title}</h2>
            {subtitle && <p className="m-0 mt-1 text-xs text-(color:--muted)">{subtitle}</p>}
            {chips && chips.length > 0 && (
              <p className="m-0 mt-2 flex flex-wrap gap-1.5">
                {chips.map((chip) => <span className={statusPill(chip.status)} key={`${chip.status}-${chip.label}`}>{chip.label}</span>)}
              </p>
            )}
          </div>
          <button ref={closeRef} className={iconButton} type="button" onClick={onClose} aria-label={closeLabel}><X size={18} aria-hidden="true" /></button>
        </header>
        {excerpts?.map((item, index) => (
          <figure className="m-0 grid gap-1.5" key={`${item.label}-${index}`}>
            <figcaption className="text-[11px] font-semibold text-(color:--muted)">{item.label}</figcaption>
            <blockquote className="m-0 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-(color:--ash-150) bg-(--ash-50) px-3.5 py-2.5 text-[13px] leading-relaxed text-(color:--ink) text-pretty [overflow-wrap:anywhere]">{item.text}</blockquote>
          </figure>
        ))}
        <dl className="m-0 grid rounded-lg border border-(color:--ash-150) text-[13px]">
          {rows.map(([label, value], index) => (
            <div className="grid gap-0.5 border-t border-(color:--ash-150) px-3 py-2 first:border-t-0 sm:grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)] sm:gap-4" key={`${label}-${index}`}>
              <dt className="text-xs text-(color:--muted) sm:pt-px">{label}</dt>
              <dd className="m-0 tabular-nums [overflow-wrap:anywhere]">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
