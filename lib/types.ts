export type AnalysisEvidence = {
  id: string;
  label: string;
  text: string;
  url: string;
};

export type AnalysisFinding = {
  title: string;
  detail: string;
  sources: AnalysisEvidence[];
};

export type AnalysisDetail = {
  summary: string;
  findings: AnalysisFinding[];
  limitations: string;
  /** Dolores: 1–4 etiquetas cortas. Ausente en análisis con el formato anterior. */
  tags?: string[];
  /** Dolores: reporte breve con evidencia y ángulo comercial. Ausente en análisis con el formato anterior. */
  report?: string;
  /** Foco de dolor usado en el análisis (para no repetirlo con el mismo foco). */
  focus?: string;
  status?: "completed" | "no_data";
  social_networks?: SocialNetwork[];
};

export type SocialNetwork = "facebook" | "instagram" | "youtube" | "linkedin";

export type LeadReview = {
  text: string;
  rating: number | null;
  published_at: string;
  owner_response: string;
};

export type Lead = {
  id: string;
  batch: string;
  name: string;
  maps_url: string;
  address: string;
  review_count: string;
  average_rating: string;
  phone: string;
  email: string;
  website: string;
  social_profiles: string;
  category: string;
  source_reviews: LeadReview[];
  source_context: {
    review_topics?: { topic?: string; mentions?: number }[];
    rating_breakdown?: Record<string, number>;
    owner_description?: string;
    details_status?: string;
  };
  pain_points: string;
  enrichment: string;
  pain_points_detail: AnalysisDetail | null;
  enrichment_detail: AnalysisDetail | null;
  created_at: string;
  created: string;
};

export type LeadBatch = {
  id: string;
  user?: string;
  keywords: string[];
  country: string;
  province: string;
  district: string;
  requested_count: number;
  result_count: number;
  status: "running" | "completed" | "partial" | "failed";
  created_at: string;
  created: string;
};

export type LeadColumnKey = keyof Lead | `review_${1 | 2 | 3 | 4 | 5}` | `rating_${1 | 2 | 3 | 4 | 5}` | `social_${SocialNetwork}`;

export const LEAD_COLUMNS: { key: LeadColumnKey; label: string }[] = [
  { key: "name", label: "Nombre" },
  { key: "maps_url", label: "Link en Maps" },
  { key: "address", label: "Dirección" },
  { key: "phone", label: "Teléfono" },
  { key: "email", label: "Mail" },
  { key: "review_count", label: "Reseñas" },
  { key: "average_rating", label: "Promedio" },
  ...([1, 2, 3, 4, 5] as const).map((number) => ({ key: `review_${number}` as const, label: `Reseña ${number}` })),
  ...([1, 2, 3, 4, 5] as const).map((number) => ({ key: `rating_${number}` as const, label: `Reseñas ${number}★` })),
  { key: "website", label: "Website" },
  { key: "category", label: "Rubro" },
  { key: "pain_points", label: "Dolores" },
  { key: "enrichment", label: "Enriquecimiento" },
];

export function getSocialProfileUrl(value: string, network: SocialNetwork): string {
  return value.split("\n").flatMap((line) => {
    const separator = line.indexOf(": ");
    if (separator < 1) return [];
    const label = line.slice(0, separator).toLowerCase();
    const url = line.slice(separator + 2).trim();
    const matches: Record<SocialNetwork, RegExp> = {
      facebook: /facebook|fb\.com|fb\.me/i,
      instagram: /instagram/i,
      youtube: /youtube|youtu\.be/i,
      linkedin: /linkedin|lnkd\.in/i,
    };
    return matches[network].test(label) && /^https?:\/\//i.test(url) ? [url] : [];
  })[0] || "";
}

/** Devuelve la etiqueta traducida de una columna; `fallback` es la etiqueta en español por defecto. */
export type LeadColumnLabeler = (key: LeadColumnKey, fallback: string) => string;

/**
 * `includeEnrichment` (DEV only) controls the enrichment column and the social network columns it produces.
 * `label` (opcional) traduce las etiquetas; sin él se usan las etiquetas en español.
 */
export function getLeadColumns(leads: Lead[], activeNetworks: SocialNetwork[] = [], includeEnrichment = false, label?: LeadColumnLabeler): { key: LeadColumnKey; label: string }[] {
  const networks = new Set<SocialNetwork>(activeNetworks);
  leads.forEach((lead) => lead.enrichment_detail?.social_networks?.forEach((network) => networks.add(network)));
  const networkColumns = (Object.entries({
    facebook: "Facebook",
    instagram: "Instagram",
    youtube: "YouTube",
    linkedin: "LinkedIn",
  }) as [SocialNetwork, string][])
    .filter(([network]) => networks.has(network))
    .map(([network, label]) => ({ key: `social_${network}` as const, label }));
  return LEAD_COLUMNS
    .filter((column) => includeEnrichment || column.key !== "enrichment")
    .flatMap((column) => column.key === "website" && includeEnrichment ? [column, ...networkColumns] : [column])
    .map((column) => label ? { key: column.key, label: label(column.key, column.label) } : column);
}

export function getLeadColumnValue(lead: Lead, key: LeadColumnKey, ownerResponseLabel = "Respuesta del negocio"): string {
  const socialMatch = /^social_(facebook|instagram|youtube|linkedin)$/.exec(key);
  if (socialMatch) return getSocialProfileUrl(lead.social_profiles || "", socialMatch[1] as SocialNetwork);

  const reviewMatch = /^review_([1-5])$/.exec(key);
  if (reviewMatch) {
    const review = lead.source_reviews?.[Number(reviewMatch[1]) - 1];
    if (!review) return "";
    return [
      review.rating === null ? "" : `${review.rating}/5`,
      review.published_at,
      review.text,
      review.owner_response ? `${ownerResponseLabel}: ${review.owner_response}` : "",
    ].filter(Boolean).join("\n");
  }

  const ratingMatch = /^rating_([1-5])$/.exec(key);
  if (ratingMatch) {
    const count = lead.source_context?.rating_breakdown?.[ratingMatch[1]];
    return typeof count === "number" ? String(count) : "";
  }

  const value = lead[key as keyof Lead];
  if (value == null) return "";
  return typeof value === "string" || typeof value === "number" ? String(value) : JSON.stringify(value);
}
