import { NextResponse } from "next/server";
import { isPocketBaseConfigured } from "@/lib/server/pocketbase";
import { listRecords } from "@/app/api/owner/_shared";

export type PublicStats = { leads: number; pains: number; categories: number };

const ttlMs = 30_000;
const categoryPageConcurrency = 4;
let cache: { at: number; value: Promise<PublicStats> } | null = null;

async function listLeadCategories() {
  const params = { fields: "category", filter: 'category != ""' };
  const first = await listRecords<{ category?: string }>("leads", { ...params, perPage: 200, page: 1 });
  const categories = first.items;
  let nextPage = 2;
  const lastPage = Math.min(first.totalPages, 500);

  // Read pages independently with bounded concurrency instead of one network round-trip at a time.
  async function readPages() {
    while (nextPage <= lastPage) {
      const page = nextPage++;
      const result = await listRecords<{ category?: string }>("leads", { ...params, perPage: 200, page });
      categories.push(...result.items);
    }
  }

  await Promise.all(Array.from({ length: Math.min(categoryPageConcurrency, lastPage - 1) }, readPages));
  return categories;
}

async function loadStats(): Promise<PublicStats> {
  const [leads, pains, categories] = await Promise.all([
    listRecords("leads", { perPage: 1, fields: "id" }),
    listRecords("leads", { perPage: 1, fields: "id", filter: 'pain_points != ""' }),
    // PocketBase has no DISTINCT; scan only the category field (cached for 30 seconds).
    listLeadCategories(),
  ]);
  return {
    leads: leads.totalItems,
    pains: pains.totalItems,
    categories: new Set(categories.map((lead) => lead.category?.trim().toLowerCase()).filter(Boolean)).size,
  };
}

/** Métricas públicas de la landing: leads generados, dolores analizados y rubros distintos. Cache compartida de 30 s. */
export async function GET() {
  if (!isPocketBaseConfigured()) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  if (!cache || Date.now() - cache.at > ttlMs) {
    const value = loadStats();
    cache = { at: Date.now(), value };
    value.catch(() => { if (cache?.value === value) cache = null; });
  }
  try {
    return NextResponse.json(await cache.value, { headers: { "Cache-Control": "public, max-age=30, s-maxage=30, stale-while-revalidate=60" } });
  } catch (error) {
    console.error("Public stats failed:", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ error: "unavailable" }, { status: 502 });
  }
}
