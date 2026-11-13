"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { iconButton, useFocusTrap } from "../ui";

/** Simple accessible modal: title, optional subtitle and a label/value list. Esc and backdrop close it. */
export function DetailDialog({ title, subtitle, rows, closeLabel, onClose }: {
  title: string;
  subtitle?: string;
  rows: [string, string][];
  closeLabel: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useFocusTrap(ref, true, onClose);
  useEffect(() => { closeRef.current?.focus(); }, []);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-(--ash-950)/45 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className="grid max-h-[calc(100dvh-32px)] w-full max-w-lg content-start gap-3.5 overflow-y-auto rounded-[10px] border border-(color:--line) bg-(--paper) p-5">
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="m-0 text-[17px] font-semibold tracking-tight">{title}</h2>
            {subtitle && <p className="m-0 mt-1 text-xs text-(color:--muted)">{subtitle}</p>}
          </div>
          <button ref={closeRef} className={iconButton} type="button" onClick={onClose} aria-label={closeLabel}><X size={18} aria-hidden="true" /></button>
        </header>
        <dl className="m-0 grid gap-2 text-[13px]">
          {rows.map(([label, value], index) => (
            <div className="grid gap-0.5 border-t border-(color:--ash-150) pt-2 first:border-t-0 first:pt-0 sm:grid-cols-[minmax(0,10rem)_1fr] sm:gap-3" key={`${label}-${index}`}>
              <dt className="text-xs text-(color:--muted)">{label}</dt>
              <dd className="m-0 break-words">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
