import { NextResponse } from "next/server";
import { isPocketBaseConfigured } from "@/lib/server/pocketbase";
import { listAllRecords, listRecords } from "@/app/api/owner/_shared";

export type PublicStats = { leads: number; pains: number; categories: number };

const ttlMs = 30_000;
let cache: { at: number; value: Promise<PublicStats> } | null = null;

async function loadStats(): Promise<PublicStats> {
  const [leads, pains, categories] = await Promise.all([
    listRecords("leads", { perPage: 1, fields: "id" }),
    listRecords("leads", { perPage: 1, fields: "id", filter: 'pain_points != ""' }),
    // ponytail: PocketBase no tiene DISTINCT; escanea `category` de todos los leads (cache 30 s). Si crece mucho, pasar a una vista agregada.
    listAllRecords<{ category?: string }>("leads", { fields: "category", filter: 'category != ""' }),
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
