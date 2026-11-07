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
  category: string;
  pain_points: string;
  enrichment: string;
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

export const LEAD_COLUMNS: { key: keyof Lead; label: string }[] = [
  { key: "name", label: "Nombre" },
  { key: "maps_url", label: "Link en Maps" },
  { key: "address", label: "Dirección" },
  { key: "review_count", label: "Reseñas" },
  { key: "average_rating", label: "Promedio" },
  { key: "phone", label: "Teléfono" },
  { key: "email", label: "Mail" },
  { key: "website", label: "Website" },
  { key: "category", label: "Rubro" },
  { key: "pain_points", label: "Dolores" },
  { key: "enrichment", label: "Enriquecimiento" },
];
