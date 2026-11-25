"use client";

import { useEffect, useId, useState, type ComponentType } from "react";
import { useTranslations } from "next-intl";
import { Check, Copy, Mail } from "lucide-react";
import { FaFacebook, FaGoogle, FaInstagram, FaLinkedin, FaTiktok, FaWhatsapp, FaYoutube } from "react-icons/fa";
import { FaXTwitter } from "react-icons/fa6";
import { buildUtmUrl, UTM_PRESETS, type UtmFields, type UtmPresetId } from "@/lib/utm";
import { cardClass, controlClass, ghostButton, hintText, mutedText } from "../ui";

// Generador de links con UTM por canal. Todo en el navegador: no guarda nada.
const ICONS: Record<UtmPresetId, { Icon: ComponentType<{ size?: number; className?: string }>; color: string }> = {
  instagram: { Icon: FaInstagram, color: "text-[#E1306C]" },
  facebook: { Icon: FaFacebook, color: "text-[#1877F2]" },
  linkedin: { Icon: FaLinkedin, color: "text-[#0A66C2]" },
  tiktok: { Icon: FaTiktok, color: "text-(color:--ink)" },
  x: { Icon: FaXTwitter, color: "text-(color:--ink)" },
  youtube: { Icon: FaYoutube, color: "text-[#FF0000]" },
  whatsapp: { Icon: FaWhatsapp, color: "text-[#25D366]" },
  email: { Icon: Mail, color: "text-(color:--ink)" },
  google: { Icon: FaGoogle, color: "text-[#4285F4]" },
};

const DEFAULT_URL = "https://leadta.app/";

export function UtmBuilder() {
  const t = useTranslations("Owner.analytics.utm");
  const id = useId();
  const [preset, setPreset] = useState<UtmPresetId>("instagram");
  const [url, setUrl] = useState(DEFAULT_URL);
  const [fields, setFields] = useState<UtmFields>({ source: "instagram", medium: "social", campaign: "", content: "", term: "" });
  const [copied, setCopied] = useState(false);
  const result = buildUtmUrl(url, fields);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);

  const choose = (next: UtmPresetId) => {
    const found = UTM_PRESETS.find((item) => item.id === next);
    if (!found) return;
    setPreset(next);
    setFields((current) => ({ ...current, source: found.source, medium: found.medium }));
  };
  const set = (key: keyof UtmFields) => (event: { target: { value: string } }) => setFields((current) => ({ ...current, [key]: event.target.value }));
  const copy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  const field = (key: keyof UtmFields, required = false) => (
    <div className="grid gap-1.5">
      <label htmlFor={`${id}-${key}`} className="text-xs font-semibold">{t(`fields.${key}`)}{required ? " *" : ""}</label>
      <input id={`${id}-${key}`} className={controlClass} value={fields[key]} onChange={set(key)} placeholder={t(`placeholders.${key}`)} maxLength={120} autoComplete="off" />
    </div>
  );

  return (
    <section className={`${cardClass} min-w-0`} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="m-0 mb-1 text-[13px] font-semibold">{t("title")}</h2>
      <p className={`${mutedText} mb-3`}>{t("hint")}</p>

      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label={t("channel")}>
        {UTM_PRESETS.map((item) => {
          const { Icon, color } = ICONS[item.id];
          const active = item.id === preset;
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={active}
              onClick={() => choose(item.id)}
              className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(color:--ink) ${active ? "border-(color:--ink) bg-(--ash-100)" : "border-(color:--ash-300) bg-(--paper) hover:bg-(--ash-50)"}`}
            >
              <Icon size={14} className={color} />
              {t(`presets.${item.id}`)}
            </button>
          );
        })}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="grid gap-1.5 md:col-span-2">
          <label htmlFor={`${id}-url`} className="text-xs font-semibold">{t("fields.url")} *</label>
          <input id={`${id}-url`} className={controlClass} type="url" inputMode="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder={DEFAULT_URL} maxLength={2000} autoComplete="off" />
        </div>
        {field("source", true)}
        {field("medium", true)}
        {field("campaign", true)}
        {field("content")}
        {field("term")}
      </div>

      <div className="mt-3 grid gap-2">
        <span className="text-xs font-semibold">{t("result")}</span>
        <div className="flex flex-wrap items-center gap-2">
          <output htmlFor={`${id}-url ${id}-campaign`} className="min-w-0 flex-1 break-all rounded-lg border border-(color:--line) bg-(--ash-50) px-3 py-2.5 font-mono text-xs text-(color:--ink)" aria-live="polite">
            {result ?? <span className="font-sans text-(color:--muted)">{t("incomplete")}</span>}
          </output>
          <button type="button" className={ghostButton} onClick={() => void copy()} disabled={!result}>
            {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
            {copied ? t("copied") : t("copy")}
          </button>
        </div>
        <p className={hintText}>{t("slugHint")}</p>
      </div>
    </section>
  );
}
