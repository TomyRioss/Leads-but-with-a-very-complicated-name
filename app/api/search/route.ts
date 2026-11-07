import { NextResponse } from "next/server";
import { getCurrentUser, withRefreshedSession } from "@/lib/server/auth";
import { createLeadRecords, isPocketBaseConfigured, pocketBaseFetch } from "@/lib/server/pocketbase";

export const maxDuration = 300;

const actorId = "nwua9Gu5YrADL7ZDj";
const allowedCounts = new Set([5, 10, 15, 20, 25, 30]);
const isDevelopmentEnvironment = process.env.ENVIROMENT?.trim().toLowerCase() === "dev";

type ActorPlace = Record<string, unknown>;

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function firstEmail(place: ActorPlace): string {
  if (typeof place.email === "string") return place.email.trim();
  const impressum = place.impressum && typeof place.impressum === "object"
    ? (place.impressum as { emails?: unknown })
    : undefined;
  for (const emailList of [place.emails, impressum?.emails]) {
    if (!Array.isArray(emailList)) continue;
    const first = emailList.find((value) => typeof value === "string" && value.trim());
    if (typeof first === "string") return first.trim();
    const nested = emailList.find((value) => {
      if (!value || typeof value !== "object") return false;
      const item = value as { email?: unknown; value?: unknown };
      return typeof item.email === "string" || typeof item.value === "string";
    }) as { email?: string; value?: string } | undefined;
    if (nested?.email || nested?.value) return (nested.email || nested.value || "").trim();
  }
  const contacts = place.companyContacts;
  if (Array.isArray(contacts)) {
    const contact = contacts.find(
      (value) => value && typeof value === "object" && typeof (value as { email?: unknown }).email === "string",
    ) as { email?: string } | undefined;
    return contact?.email?.trim() ?? "";
  }
  return "";
}

function mapPlace(place: ActorPlace) {
  const placeId = asText(place.placeId);
  const mapsUrl = asText(place.url) || asText(place.mapsUrl) ||
    (placeId ? `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(placeId)}` : "");
  const score = typeof place.totalScore === "number" ? place.totalScore : null;
  const reviewCount = typeof place.reviewsCount === "number" ? place.reviewsCount : null;
  const categories = Array.isArray(place.categories)
    ? place.categories.filter((value): value is string => typeof value === "string" && Boolean(value.trim())).join(", ")
    : "";

  return {
    name: asText(place.title),
    maps_url: mapsUrl,
    address: asText(place.address),
    review_count: reviewCount === null ? "" : String(reviewCount),
    average_rating: score === null ? "" : String(score),
    phone: asText(place.phone),
    email: firstEmail(place),
    website: asText(place.website),
    category: asText(place.categoryName) || categories,
    pain_points: "",
    enrichment: "",
    source_key: placeId || mapsUrl || `${asText(place.title)}|${asText(place.address)}`.toLowerCase(),
  };
}

async function actorSearch(
  token: string,
  keyword: string,
  location: string,
  limit: number,
): Promise<ActorPlace[]> {
  const response = await fetch(
    `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?timeout=300&format=json&clean=true`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        searchStringsArray: [keyword],
        locationQuery: location,
        maxCrawledPlacesPerSearch: limit,
        language: "es",
        scrapeContacts: true,
      }),
      signal: AbortSignal.timeout(300_000),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Apify respondió ${response.status}: ${detail.slice(0, 260)}`);
  }

  const results: unknown = await response.json();
  if (!Array.isArray(results)) throw new Error("Apify devolvió un formato de resultados inesperado.");
  return results as ActorPlace[];
}

export async function POST(request: Request) {
  let session: Awaited<ReturnType<typeof getCurrentUser>>;
  try {
    session = await getCurrentUser(request);
  } catch {
    return NextResponse.json({ error: "No se pudo conectar con el servicio de cuentas." }, { status: 503 });
  }
  if (!session) return NextResponse.json({ error: "Iniciá sesión antes de buscar leads." }, { status: 401 });

  const token = process.env.APIFY_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "Falta APIFY_TOKEN en la configuración del servidor." }, { status: 503 });
  }
  if (!isPocketBaseConfigured()) {
    return NextResponse.json({ error: "Falta configurar PocketBase en el servidor." }, { status: 503 });
  }

  let body: {
    keywords?: unknown;
    country?: unknown;
    province?: unknown;
    district?: unknown;
    count?: unknown;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "La solicitud no contiene datos válidos." }, { status: 400 });
  }

  const keywords = Array.isArray(body.keywords)
    ? [...new Set(body.keywords.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean))]
    : [];
  const country = typeof body.country === "string" ? body.country.trim() : "";
  const province = typeof body.province === "string" ? body.province.trim() : "";
  const district = typeof body.district === "string" ? body.district.trim() : "";
  const count = typeof body.count === "number" ? body.count : Number(body.count);

  if (keywords.length === 0 || keywords.length > 10 || keywords.some((keyword) => keyword.length > 120)) {
    return NextResponse.json({ error: "Ingresá entre 1 y 10 keywords, con un máximo de 120 caracteres cada una." }, { status: 400 });
  }
  if (!country || country.length > 100 || province.length > 100 || district.length > 100) {
    return NextResponse.json({ error: "El país es obligatorio. Cada zona admite hasta 100 caracteres." }, { status: 400 });
  }
  if (!allowedCounts.has(count) && !(isDevelopmentEnvironment && (count === 1 || count === 2))) {
    const allowed = isDevelopmentEnvironment ? "1, 2, 5, 10, 15, 20, 25 o 30" : "5, 10, 15, 20, 25 o 30";
    return NextResponse.json({ error: `El lote debe ser de ${allowed} leads.` }, { status: 400 });
  }

  const location = [district, province, country].filter(Boolean).join(", ");
  let currentBatchId: string | null = null;
  let persistedCount = 0;

  try {
    const batch = await pocketBaseFetch<{ id: string }>("/api/collections/lead_batches/records", {
      method: "POST",
      body: JSON.stringify({
        keywords,
        country,
        province,
        district,
        user: session.user.id,
        requested_count: count,
        result_count: 0,
        status: "running",
        created_at: new Date().toISOString(),
      }),
    });
    currentBatchId = batch.id;

    const leads = new Map<string, ReturnType<typeof mapPlace>>();
    let actorError = "";

    for (const keyword of keywords) {
      const remaining = count - leads.size;
      if (remaining <= 0) break;

      try {
        const places = await actorSearch(token, keyword, location, remaining);
        for (const place of places) {
          const mapped = mapPlace(place);
          if (!mapped.name) continue;
          leads.set(mapped.source_key, mapped);
          if (leads.size >= count) break;
        }
      } catch (error) {
        actorError = error instanceof Error ? error.message : "Falló una búsqueda de Apify.";
        break;
      }
    }

    const records = [...leads.values()].map((lead) => ({
      name: lead.name,
      maps_url: lead.maps_url,
      address: lead.address,
      review_count: lead.review_count,
      average_rating: lead.average_rating,
      phone: lead.phone,
      email: lead.email,
      website: lead.website,
      category: lead.category,
      pain_points: lead.pain_points,
      enrichment: lead.enrichment,
      created_at: new Date().toISOString(),
    }));
    let persistenceError = "";
    try {
      const persistence = await createLeadRecords(batch.id, records);
      persistedCount = persistence.created;
      if (persistence.failed > 0) persistenceError = "No se pudieron guardar todos los leads en PocketBase.";
    } catch {
      persistenceError = "No se pudieron guardar los leads en PocketBase.";
    }

    const hasWarning = Boolean(actorError || persistenceError);
    const status = hasWarning ? (persistedCount > 0 ? "partial" : "failed") : "completed";
    await pocketBaseFetch(`/api/collections/lead_batches/records/${batch.id}`, {
      method: "PATCH",
      body: JSON.stringify({ result_count: persistedCount, status }),
    });

    const filter = encodeURIComponent(`batch = "${batch.id}"`);
    const saved = await pocketBaseFetch<{ items: Record<string, unknown>[] }>(
      `/api/collections/leads/records?perPage=100&sort=created_at&filter=${filter}`,
    );
    return withRefreshedSession(
      NextResponse.json({
        batchId: batch.id,
        leads: saved.items,
        status,
        warning: [actorError, persistenceError].filter(Boolean).join(" ") || undefined,
      }),
      session.token,
    );
  } catch (error) {
    if (currentBatchId) {
      try {
        await pocketBaseFetch(`/api/collections/lead_batches/records/${currentBatchId}`, {
          method: "PATCH",
          body: JSON.stringify({ result_count: persistedCount, status: persistedCount > 0 ? "partial" : "failed" }),
        });
      } catch {
        // Preserve the original search error if PocketBase also fails to update the batch.
      }
    }
    const message = error instanceof Error ? error.message : "No se pudo completar la búsqueda.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
