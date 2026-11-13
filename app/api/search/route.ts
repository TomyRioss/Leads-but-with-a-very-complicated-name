import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { getCurrentUser, withRefreshedSession } from "@/lib/server/auth";
import { createLeadRecords, isPocketBaseConfigured, pocketBaseFetch } from "@/lib/server/pocketbase";
import { CREDITS_PER_LEAD, CreditOperationBusyError, InsufficientCreditsError, reserveLeadCredits } from "@/lib/server/credits";
import { uiError } from "@/lib/server/public-error";
import { errorTranslator, resolveLocale } from "@/lib/server/locale";
import { planRandomSearch, remainingCallTimeoutMs, splitEvenly, RANDOM_LOCATION_COUNTRIES, type RandomSearchSlot } from "@/lib/search-random-location";

export const maxDuration = 300;

const actorId = "tBH60CegtoC2QNtaR";
const allowedCounts = new Set([5, 10, 25, 50, 75, 100, 125, 150]);
const randomConcurrency = 5;
const isDevelopmentEnvironment = process.env.ENVIROMENT?.trim().toLowerCase() === "dev";

type ActorPlace = Record<string, unknown>;
type SearchFilters = {
  minReviews?: number;
  maxReviews?: number;
  minRating?: number;
  website: "any" | "with" | "without";
  phone: "any" | "with" | "without";
  email: "any" | "with" | "without";
  skipClosed: boolean;
};

/** Ejecuta `task` sobre `items` con a lo sumo `limit` en vuelo, conservando el orden de resultados. */
async function mapLimited<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]);
    }
  }));
  return results;
}

type StoredReview = {
  text: string;
  rating: number | null;
  published_at: string;
  owner_response: string;
};

function mapReviews(value: unknown): StoredReview[] {
  const collection = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? [
          ...("items" in value && Array.isArray(value.items) ? value.items : []),
          ...("reviews" in value && Array.isArray(value.reviews) ? value.reviews : []),
          ...("data" in value && Array.isArray(value.data) ? value.data : []),
        ]
      : [];
  return collection.flatMap((review) => {
    if (!review || typeof review !== "object") return [];
    const item = review as Record<string, unknown>;
    const text = asText(item.text) || asText(item.textTranslated) || asText(item.originalText) || asText(item.reviewText);
    if (!text) return [];
    const rating = typeof item.rating === "number" ? item.rating : typeof item.stars === "number" ? item.stars : null;
    if (rating === null || rating < 1 || rating > 5) return [];
    return [{
      text: text.slice(0, 3000),
      rating,
      published_at: asText(item.publishedAt) || asText(item.publishedAtDate) || asText(item.publishAt) || asText(item.relativeTime),
      owner_response: (asText(item.ownerResponse) || asText(item.ownerResponseText) || asText(item.responseFromOwner)).slice(0, 1500),
    }];
  }).map((review, index) => ({ review, index, timestamp: Date.parse(review.published_at) }))
    .sort((a, b) => {
      if (a.review.rating !== b.review.rating) return (a.review.rating ?? 3) - (b.review.rating ?? 3);
      const aHasTimestamp = Number.isFinite(a.timestamp);
      const bHasTimestamp = Number.isFinite(b.timestamp);
      if (aHasTimestamp && bHasTimestamp && a.timestamp !== b.timestamp) return b.timestamp - a.timestamp;
      if (aHasTimestamp !== bHasTimestamp) return aHasTimestamp ? -1 : 1;
      return a.index - b.index;
    })
    .slice(0, 5)
    .map(({ review }) => review);
}

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

function socialProfilesText(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return Object.entries(value as Record<string, unknown>)
    .flatMap(([network, profile]) => {
      const profiles = Array.isArray(profile) ? profile : [profile];
      return profiles
        .filter((url): url is string => typeof url === "string" && /^https?:\/\//i.test(url.trim()))
        .map((url) => `${network}: ${url.trim()}`);
    })
    .join("\n");
}

function mapPlace(place: ActorPlace) {
  const placeId = asText(place.placeId);
  const mapsUrl = asText(place.mapsUrl) || asText(place.url) ||
    (placeId ? `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(placeId)}` : "");
  const score = typeof place.rating === "number" ? place.rating : typeof place.totalScore === "number" ? place.totalScore : null;
  const reviewCount = typeof place.reviewsCount === "number" ? place.reviewsCount : null;
  const categories = Array.isArray(place.categories)
    ? place.categories.filter((value): value is string => typeof value === "string" && Boolean(value.trim())).join(", ")
    : "";

  return {
    name: asText(place.name) || asText(place.title),
    maps_url: mapsUrl,
    address: asText(place.address),
    review_count: reviewCount === null ? "" : String(reviewCount),
    average_rating: score === null ? "" : String(score),
    phone: asText(place.phoneInternational) || asText(place.phone),
    email: firstEmail(place),
    website: asText(place.website),
    social_profiles: socialProfilesText(place.socialProfiles),
    category: asText(place.category) || asText(place.categoryName) || categories,
    source_reviews: mapReviews(place.reviews ?? place.reviewSamples ?? place.recentReviews),
    source_context: {
      review_topics: Array.isArray(place.reviewTopics) ? place.reviewTopics : [],
      rating_breakdown: place.ratingBreakdown && typeof place.ratingBreakdown === "object" ? place.ratingBreakdown : {},
      owner_description: asText(place.ownerDescription),
      details_status: asText(place.detailsStatus),
    },
    pain_points: "",
    enrichment: "",
    pain_points_detail: "",
    enrichment_detail: "",
    source_key: placeId || mapsUrl || `${asText(place.name) || asText(place.title)}|${asText(place.address)}`.toLowerCase(),
  };
}

async function actorSearch(
  token: string,
  keyword: string,
  location: string,
  limit: number,
  monitorName: string,
  filters: SearchFilters,
  timeoutMs = 300_000,
): Promise<ActorPlace[]> {
  const response = await fetch(
    `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?timeout=${Math.max(1, Math.ceil(timeoutMs / 1000))}&format=json&clean=true`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        searchTerms: [keyword],
        locations: [location],
        maxPlacesPerSearch: limit,
        monitorName,
        language: "es",
        includeContacts: true,
        ...(filters.minReviews !== undefined ? { minReviews: filters.minReviews } : {}),
        ...(filters.maxReviews !== undefined ? { maxReviews: filters.maxReviews } : {}),
        ...(filters.minRating !== undefined ? { minRating: filters.minRating } : {}),
        ...(filters.website !== "any" ? { website: filters.website } : {}),
        ...(filters.phone !== "any" ? { phone: filters.phone } : {}),
        ...(filters.email === "with" ? { onlyWithEmail: true } : {}),
        ...(filters.skipClosed ? { skipClosed: true } : {}),
        includeDetails: true,
      }),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Apify responded ${response.status}: ${detail.slice(0, 260)}`);
  }

  const results: unknown = await response.json();
  if (!Array.isArray(results)) throw new Error("Apify returned an unexpected results format.");
  return results as ActorPlace[];
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const t = errorTranslator(request);
  let session: Awaited<ReturnType<typeof getCurrentUser>>;
  try {
    session = await getCurrentUser(request);
  } catch {
    return NextResponse.json({ error: t("accountService") }, { status: 503 });
  }
  if (!session) return NextResponse.json({ error: t("signInToSearch") }, { status: 401 });

  const token = process.env.APIFY_TOKEN;
  if (!token) {
    return NextResponse.json({ error: uiError(t("apifyTokenMissing"), t("generic")) }, { status: 503 });
  }
  if (!isPocketBaseConfigured()) {
    return NextResponse.json({ error: uiError(t("pocketbaseNotConfiguredServer"), t("generic")) }, { status: 503 });
  }

  let body: {
    keywords?: unknown;
    country?: unknown;
    province?: unknown;
    district?: unknown;
    random?: unknown;
    count?: unknown;
    filters?: unknown;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: t("invalidRequestBody") }, { status: 400 });
  }

  const keywords = Array.isArray(body.keywords)
    ? [...new Set(body.keywords.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean))]
    : [];
  // Ubicación aleatoria: el cliente solo manda el flag; el reparto entre países se calcula acá.
  const random = body.random === true;
  const locale = resolveLocale(request);
  const country = random
    ? (locale === "en" ? `Random location · ${RANDOM_LOCATION_COUNTRIES.length} countries` : `Ubicación aleatoria · ${RANDOM_LOCATION_COUNTRIES.length} países`)
    : typeof body.country === "string" ? body.country.trim() : "";
  const province = !random && typeof body.province === "string" ? body.province.trim() : "";
  const district = !random && typeof body.district === "string" ? body.district.trim() : "";
  const count = typeof body.count === "number" ? body.count : Number(body.count);
  const rawFilters = body.filters && typeof body.filters === "object" && !Array.isArray(body.filters)
    ? body.filters as Record<string, unknown>
    : {};
  const optionalNumber = (value: unknown, max: number) => {
    if (value === "" || value === undefined || value === null) return { valid: true as const, value: undefined };
    const number = typeof value === "number" ? value : Number(value);
    return Number.isFinite(number) && number >= 0 && number <= max
      ? { valid: true as const, value: number }
      : { valid: false as const, value: undefined };
  };
  const minReviews = optionalNumber(rawFilters.minReviews, 100_000_000);
  const maxReviews = optionalNumber(rawFilters.maxReviews, 100_000_000);
  const minRating = optionalNumber(rawFilters.minRating, 5);
  const filterChoice = (value: unknown): value is "any" | "with" | "without" =>
    value === undefined || value === "any" || value === "with" || value === "without";
  const filters: SearchFilters = {
    minReviews: minReviews.value,
    maxReviews: maxReviews.value,
    minRating: minRating.value,
    website: filterChoice(rawFilters.website) ? rawFilters.website ?? "any" : "any",
    phone: filterChoice(rawFilters.phone) ? rawFilters.phone ?? "any" : "any",
    email: filterChoice(rawFilters.email) ? rawFilters.email ?? "any" : "any",
    skipClosed: rawFilters.skipClosed === true,
  };

  if (keywords.length === 0 || keywords.length > 10 || keywords.some((keyword) => keyword.length > 120)) {
    return NextResponse.json({ error: t("searchKeywords") }, { status: 400 });
  }
  if (!country || country.length > 100 || province.length > 100 || district.length > 100) {
    return NextResponse.json({ error: t("searchCountryRequired") }, { status: 400 });
  }
  if (!allowedCounts.has(count) && !(count === 1 || (isDevelopmentEnvironment && count === 2))) {
    const sizes = [...(isDevelopmentEnvironment ? [1, 2] : []), ...allowedCounts].map(String);
    const allowed = new Intl.ListFormat(resolveLocale(request), { type: "disjunction" }).format(sizes);
    return NextResponse.json({ error: t("searchBatchSize", { allowed }) }, { status: 400 });
  }
  if (!minReviews.valid || !maxReviews.valid || !minRating.valid ||
      (minReviews.value !== undefined && !Number.isInteger(minReviews.value)) ||
      (maxReviews.value !== undefined && !Number.isInteger(maxReviews.value)) ||
      !filterChoice(rawFilters.website) || !filterChoice(rawFilters.phone) || !filterChoice(rawFilters.email) ||
      (minReviews.value !== undefined && maxReviews.value !== undefined && minReviews.value > maxReviews.value)) {
    return NextResponse.json({ error: t("searchFilters") }, { status: 400 });
  }

  const location = [district, province, country].filter(Boolean).join(", ");
  const monitorFor = (place: string) => {
    const normalizedLocation = place.normalize("NFKD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim().toLowerCase();
    return `leadta-${createHash("sha256").update([session.user.id, normalizedLocation, "es"].join("|")).digest("hex").slice(0, 24)}`;
  };
  const monitorName = monitorFor(location);
  let currentBatchId: string | null = null;
  let persistedCount = 0;
  let creditReservation: Awaited<ReturnType<typeof reserveLeadCredits>> | null = null;

  try {
    // El lote de 1 lead es solo para la primera búsqueda guiada: cada corrida tiene costo fijo de Apify.
    if (count === 1 && !isDevelopmentEnvironment) {
      const own = encodeURIComponent(`user = "${session.user.id}"`);
      const previous = await pocketBaseFetch<{ items: unknown[] }>(`/api/collections/lead_batches/records?page=1&perPage=1&skipTotal=1&filter=${own}`);
      if (previous.items.length > 0) {
        return NextResponse.json({ error: t("searchFirstOnly") }, { status: 400 });
      }
    }
    creditReservation = await reserveLeadCredits(session.user.id, count);
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

    const addPlaces = (places: ActorPlace[]) => {
      for (const place of places) {
        const mapped = mapPlace(place);
        if (!mapped.name) continue;
        if (filters.email === "without" && mapped.email) continue;
        leads.set(mapped.source_key, mapped);
        if (leads.size >= count) break;
      }
    };

    if (random) {
      const runSlots = (slots: RandomSearchSlot[]) => mapLimited(slots, randomConcurrency, async (slot) => {
        // Deadline global: sin tiempo suficiente la búsqueda se omite y solo se cobra lo que se guarde.
        const timeoutMs = remainingCallTimeoutMs(Date.now() - startedAt);
        if (timeoutMs === 0) return { slot, places: [] as ActorPlace[], failed: true };
        try {
          const places = await actorSearch(token, slot.keyword, slot.country, slot.limit, monitorFor(slot.country), filters, timeoutMs);
          return { slot, places, failed: false };
        } catch (error) {
          actorError ||= uiError(error instanceof Error ? error.message : t("searchApifyFailed"), t("generic"));
          return { slot, places: [] as ActorPlace[], failed: true };
        }
      });
      const plan = planRandomSearch(count, keywords, Math.floor(Math.random() * RANDOM_LOCATION_COUNTRIES.length));
      const firstPass = await runSlots(plan);
      for (const { places } of firstPass) addPlaces(places);

      // Si faltan resultados, se pide más solo a los países/keywords que devolvieron todo lo pedido (todavía tienen), sin pasar de `count`.
      const missing = count - leads.size;
      const saturated = firstPass.filter(({ slot, places, failed }) => !failed && places.length >= slot.limit);
      if (missing > 0 && saturated.length > 0 && remainingCallTimeoutMs(Date.now() - startedAt) > 0) {
        const extras = splitEvenly(Math.min(missing, saturated.length * 5), saturated.length);
        const secondPass = await runSlots(saturated.flatMap(({ slot }, index) => extras[index] > 0 ? [{ ...slot, limit: slot.limit + extras[index] }] : []));
        for (const { places } of secondPass) addPlaces(places);
      }
    } else {
      for (const keyword of keywords) {
        const remaining = count - leads.size;
        if (remaining <= 0) break;

        try {
          const places = await actorSearch(token, keyword, location, remaining, monitorName, filters);
          addPlaces(places);
        } catch (error) {
          actorError = uiError(error instanceof Error ? error.message : t("searchApifyFailed"), t("generic"));
          break;
        }
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
      social_profiles: lead.social_profiles,
      category: lead.category,
      source_reviews: lead.source_reviews,
      source_context: lead.source_context,
      pain_points: lead.pain_points,
      enrichment: lead.enrichment,
      pain_points_detail: lead.pain_points_detail,
      enrichment_detail: lead.enrichment_detail,
      created_at: new Date().toISOString(),
    }));
    let persistenceError = "";
    try {
      const persistence = await createLeadRecords(batch.id, records);
      persistedCount = persistence.created;
      if (persistence.failed > 0) persistenceError = uiError(t("searchSaveSomeFailedDetail"), t("searchSaveSomeFailed"));
    } catch {
      persistenceError = uiError(t("searchSaveFailedDetail"), t("searchSaveFailed"));
    }

    const shortfall = leads.size < count;
    const hasError = Boolean(actorError || persistenceError);
    const status = hasError ? (persistedCount > 0 ? "partial" : "failed") : "completed";
    await pocketBaseFetch(`/api/collections/lead_batches/records/${batch.id}`, {
      method: "PATCH",
      body: JSON.stringify({ result_count: persistedCount, status }),
    });
    const credits = await creditReservation.settle(persistedCount);

    const filter = encodeURIComponent(`batch = "${batch.id}"`);
    const saved = await pocketBaseFetch<{ items: Record<string, unknown>[] }>(
      `/api/collections/leads/records?perPage=100&sort=created_at&filter=${filter}`,
    );
    return withRefreshedSession(
      NextResponse.json({
        batchId: batch.id,
        leads: saved.items,
        status,
        credits,
        creditsUsed: persistedCount * CREDITS_PER_LEAD,
        warning: [actorError, persistenceError].filter(Boolean).join(" ") || undefined,
        shortfall,
      }),
      session.token,
    );
  } catch (error) {
    let credits: number | undefined;
    if (creditReservation) {
      try {
        credits = await creditReservation.settle(persistedCount);
      } catch {
        credits = creditReservation.balance;
      }
    }
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
    if (error instanceof InsufficientCreditsError) {
      return NextResponse.json({ error: t("insufficientCredits", { required: error.required, available: error.available }), credits: error.available }, { status: 402 });
    }
    if (error instanceof CreditOperationBusyError) {
      return NextResponse.json({ error: t("creditBusy") }, { status: 409 });
    }
    console.error("Search failed:", error instanceof Error ? error.message : "unknown");
    const message = uiError(error instanceof Error ? error.message : t("searchFailedDetail"), t("searchFailed"));
    return NextResponse.json({ error: message, credits }, { status: 502 });
  } finally {
    if (creditReservation) await creditReservation.release().catch(() => undefined);
  }
}
