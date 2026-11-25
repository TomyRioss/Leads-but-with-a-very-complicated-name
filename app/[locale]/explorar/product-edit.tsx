"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import type { ExploreProduct } from "@/lib/explore/types";

const FIELD = "w-full rounded-md border border-(color:--line) bg-(--paper) px-2 py-1.5 text-xs text-(color:--ink) outline-none focus-visible:border-(color:--ink)";

/** Resumen y ubicación del paso 1 en la barra lateral, con edición manual ("¿Los datos están mal?"). */
export function ProductSummary({ product, onSaved }: { product: ExploreProduct; onSaved: (product: ExploreProduct) => void }) {
  const t = useTranslations("Explore");
  const [editing, setEditing] = useState(false);
  const [summary, setSummary] = useState(product.summary);
  const [location, setLocation] = useState(product.location);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  function open() {
    setSummary(product.summary);
    setLocation(product.location);
    setFailed(false);
    setEditing(true);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving || !summary.trim()) return;
    setSaving(true);
    setFailed(false);
    try {
      const response = await fetch("/api/explore", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summary, location }),
      });
      if (!response.ok) throw new Error("save failed");
      const data = (await response.json()) as { product: ExploreProduct };
      onSaved(data.product);
      setEditing(false);
    } catch {
      setFailed(true);
    }
    setSaving(false);
  }

  if (editing) {
    return (
      <form onSubmit={save} className="mt-1 mb-2 hidden space-y-2 pr-2 pl-10 lg:block">
        <label className="block text-[11px] font-semibold text-(color:--ash-700)">
          {t("edit.summary")}
          <textarea value={summary} onChange={(event) => setSummary(event.target.value)} maxLength={400} rows={4} required className={`${FIELD} mt-1 resize-y font-normal`} />
        </label>
        <label className="block text-[11px] font-semibold text-(color:--ash-700)">
          {t("location")}
          <input value={location} onChange={(event) => setLocation(event.target.value)} maxLength={120} className={`${FIELD} mt-1 font-normal`} />
        </label>
        {failed ? <p role="alert" className="text-xs text-(color:--ash-800)">{t("edit.failed")}</p> : null}
        <div className="flex gap-2">
          <button type="submit" disabled={saving || !summary.trim()} className="inline-flex min-h-8 items-center gap-1.5 rounded-md bg-(--lime) px-3 text-xs font-semibold hover:bg-(--lime-dark) disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-(color:--ink)">
            {saving ? <Loader2 size={13} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
            {t("edit.save")}
          </button>
          <button type="button" onClick={() => setEditing(false)} disabled={saving} className="min-h-8 rounded-md px-2 text-xs font-medium text-(color:--muted) hover:text-(color:--ink) focus-visible:outline-2 focus-visible:outline-(color:--ink)">
            {t("edit.cancel")}
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="mt-1 mb-2 hidden pr-2 pl-10 lg:block">
      <p className="line-clamp-3 text-xs leading-relaxed text-(color:--muted)">{product.summary}</p>
      <p className="mt-1.5 text-xs text-(color:--ash-700)">{t("location")} | {product.location || t("noLocation")}</p>
      <button type="button" onClick={open} className="mt-1.5 rounded text-xs font-medium text-(color:--ink) underline decoration-(--ash-300) underline-offset-4 hover:decoration-(--ink) focus-visible:outline-2 focus-visible:outline-(color:--ink)">
        {t("edit.open")}
      </button>
    </div>
  );
}
