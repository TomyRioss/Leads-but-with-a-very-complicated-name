// Generador de links con parámetros UTM (panel owner > Analíticas). Puro: el selfcheck lo corre con node plano.

/** Presets por canal: utm_source y utm_medium en minúsculas, como los agrupa PostHog. */
export const UTM_PRESETS = [
  { id: "instagram", source: "instagram", medium: "social" },
  { id: "facebook", source: "facebook", medium: "social" },
  { id: "linkedin", source: "linkedin", medium: "social" },
  { id: "tiktok", source: "tiktok", medium: "social" },
  { id: "x", source: "x", medium: "social" },
  { id: "youtube", source: "youtube", medium: "video" },
  { id: "whatsapp", source: "whatsapp", medium: "messaging" },
  { id: "email", source: "newsletter", medium: "email" },
  { id: "google", source: "google", medium: "cpc" },
] as const;

export type UtmPresetId = (typeof UTM_PRESETS)[number]["id"];
export type UtmFields = { source: string; medium: string; campaign: string; content: string; term: string };

const MAX_VALUE = 100;

/** Valor UTM consistente: minúsculas, sin acentos, espacios y símbolos → "-". "Black Friday 2026!" → "black-friday-2026". */
export function slugUtm(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, MAX_VALUE);
}

/**
 * URL final con los UTM. null si la URL no es http(s) válida o faltan source, medium o campaign.
 * Respeta los parámetros que ya tenga la URL y reemplaza los utm_* existentes.
 */
export function buildUtmUrl(base: string, fields: UtmFields): string | null {
  let url: URL;
  try {
    url = new URL(base.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const values = { source: slugUtm(fields.source), medium: slugUtm(fields.medium), campaign: slugUtm(fields.campaign), content: slugUtm(fields.content), term: slugUtm(fields.term) };
  if (!values.source || !values.medium || !values.campaign) return null;
  for (const key of ["source", "medium", "campaign", "content", "term"] as const) {
    url.searchParams.delete(`utm_${key}`);
    if (values[key]) url.searchParams.set(`utm_${key}`, values[key]);
  }
  return url.toString();
}
