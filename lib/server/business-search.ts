import { createHash } from "node:crypto";
import type { AppUser } from "@/lib/server/auth";
import type { ApiResult } from "@/lib/server/api-result";
import { createLeadRecords, isPocketBaseConfigured, pocketBaseFetch } from "@/lib/server/pocketbase";
import { CREDITS_PER_LEAD, CreditOperationBusyError, InsufficientCreditsError, reserveLeadCredits } from "@/lib/server/credits";
import { featurePricing } from "@/lib/server/campaigns";
import { uiError } from "@/lib/server/public-error";
import { isDevOnlyEnabled } from "@/lib/env-features";
import { getTranslator, type Locale } from "@/lib/server/locale";
import { countriesLabel, planRandomSearch, remainingCallTimeoutMs, splitEvenly, MAX_SEARCH_COUNTRIES, RANDOM_LOCATION_COUNTRIES, type RandomSearchSlot } from "@/lib/search-random-location";
import { cleanWebsiteUrl } from "@/lib/url-display";
import { parseCardKey } from "@/lib/people";
import { resolveLocation, type LocationResolution, type ResolvedLocation } from "@/lib/server/geography";
import { isFreeTopUp, matchesLeadRules, parseLeadRules, TOPUP_MAX_MISSING } from "@/lib/lead-rules";
import { verifyPendingChange } from "@/lib/server/lead-suite-agent";
import { checkWhatsAppNumbers, whatsAppDigits } from "@/lib/server/whatsapp";

const actorId = "tBH60CegtoC2QNtaR";
const allowedCounts = new Set([5, 10, 25, 50, 75, 100, 125, 150]);
const randomConcurrency = 5;
// Filter retry: ask for 4x the places (max 100) once when filters left the search short; only if time remains.
const filterRetryLimit = (limit: number) => Math.min(100, Math.max(limit * 4, 10));
const FILTER_RETRY_BEFORE_MS = 120_000;
// WhatsApp replacement: rounds of search + verification, and the time after which no new round starts.
const WA_MAX_ROUNDS = 3;
const WA_ROUND_BEFORE_MS = 150_000;
const allowSmallBatches = isDevOnlyEnabled("small_batches");
const locationErrorKeys: Record<Extract<LocationResolution, { ok: false }>["field"], string> = {
  country: "geoInvalidCountry",
  province: "geoStateNotInCountry",
  district: "searchCountryRequired",
};

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
    website: cleanWebsiteUrl(asText(place.website)),
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

/**
 * POST /api/search after auth: validates the body, reserves credits, runs the Apify searches and saves the batch.
 * `startedAt`: when the request began (time budgets count from there).
 */
export async function runBusinessSearch(user: Pick<AppUser, "id">, rawBody: unknown, opts: { locale: Locale; startedAt?: number }): Promise<ApiResult> {
  const startedAt = opts.startedAt ?? Date.now();
  const t = getTranslator(opts.locale, "Errors");

  const token = process.env.APIFY_TOKEN;
  if (!token) {
    return { status: 503, body: { error: uiError(t("apifyTokenMissing"), t("generic")) } };
  }
  if (!isPocketBaseConfigured()) {
    return { status: 503, body: { error: uiError(t("pocketbaseNotConfiguredServer"), t("generic")) } };
  }

  const body = rawBody as {
    keywords?: unknown;
    country?: unknown;
    countries?: unknown;
    cardKey?: unknown;
    province?: unknown;
    district?: unknown;
    random?: unknown;
    count?: unknown;
    filters?: unknown;
    customFilters?: unknown;
    topUp?: unknown;
  };

  // Top-up: a signed topup_batch card refills an existing batch; every search param comes from the card, never the body.
  const topUp = body.topUp === undefined ? null : verifyPendingChange(body.topUp, user.id);
  if (body.topUp !== undefined && topUp?.kind !== "topup_batch") {
    return { status: 400, body: { error: t("invalidRequestBody") } };
  }
  const extra = topUp?.extra ?? {};
  const lines = (value: unknown) => (typeof value === "string" ? value.split("\n") : []);
  const topUpBatchId = typeof extra.batchId === "string" ? extra.batchId : "";
  const topUpRound = Number(extra.round);
  const topUpFree = extra.free === 1;
  // WhatsApp replacement: free top-up whose candidates must be registered on WhatsApp (the route that signs it removes the same number of leads without WhatsApp).
  const waVerify = topUp !== null && extra.wa === 1;
  if (waVerify && !topUpFree) return { status: 400, body: { error: t("invalidRequestBody") } };
  if (topUp && (!/^[a-zA-Z0-9]{1,30}$/.test(topUpBatchId) || !Number.isInteger(topUpRound) || topUpRound < 1)) {
    return { status: 400, body: { error: t("invalidRequestBody") } };
  }
  const input: typeof body = topUp
    ? {
        keywords: lines(extra.keywords),
        country: extra.country,
        countries: lines(extra.countries),
        province: extra.province,
        district: extra.district,
        count: extra.missing,
        filters: { website: extra.website || undefined, phone: extra.phone || undefined, email: extra.email || undefined, skipClosed: extra.skipClosed === 1 },
        customFilters: extra.rules,
      }
    : body;
  const rules = parseLeadRules(input.customFilters);
  if (!rules) return { status: 400, body: { error: t("searchFilters") } };

  const keywords = Array.isArray(input.keywords)
    ? [...new Set(input.keywords.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean))]
    : [];
  // Ubicación aleatoria: el cliente solo manda el flag; el reparto entre países se calcula acá.
  const random = input.random === true;
  const locale = opts.locale;
  // Varios países: mismo reparto que el modo aleatorio, con la lista del usuario y sin provincia/ciudad.
  const chosenCountries = !random && Array.isArray(input.countries)
    ? [...new Set(input.countries.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean))]
    : [];
  const multiCountry = chosenCountries.length > 1;
  const spreadCountries: readonly string[] | null = random ? RANDOM_LOCATION_COUNTRIES : multiCountry ? chosenCountries : null;
  const country = random
    ? (locale === "en" ? `Random location · ${RANDOM_LOCATION_COUNTRIES.length} countries` : `Ubicación aleatoria · ${RANDOM_LOCATION_COUNTRIES.length} países`)
    : multiCountry ? countriesLabel(chosenCountries)
    : chosenCountries[0] ?? (typeof input.country === "string" ? input.country.trim() : "");
  const province = !spreadCountries && typeof input.province === "string" ? input.province.trim() : "";
  const district = !spreadCountries && typeof input.district === "string" ? input.district.trim() : "";
  let count = typeof input.count === "number" ? input.count : Number(input.count);
  const cardKey = parseCardKey(input.cardKey);
  const rawFilters = input.filters && typeof input.filters === "object" && !Array.isArray(input.filters)
    ? input.filters as Record<string, unknown>
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
  const filtered = filters.minReviews !== undefined || filters.maxReviews !== undefined || filters.minRating !== undefined ||
    filters.website !== "any" || filters.phone !== "any" || filters.email !== "any" || rules.length > 0;

  if (keywords.length === 0 || keywords.length > 10 || keywords.some((keyword) => keyword.length > 120)) {
    return { status: 400, body: { error: t("searchKeywords") } };
  }
  if (!country || country.length > 100 || province.length > 100 || district.length > 100 ||
      chosenCountries.length > MAX_SEARCH_COUNTRIES || chosenCountries.some((value) => value.length > 100)) {
    return { status: 400, body: { error: t("searchCountryRequired") } };
  }
  if (topUp) {
    if (!Number.isInteger(count) || count < 1 || count > TOPUP_MAX_MISSING) return { status: 400, body: { error: t("invalidRequestBody") } };
  } else if (!allowedCounts.has(count) && !(count === 1 || (allowSmallBatches && count === 2))) {
    const sizes = [...(allowSmallBatches ? [1, 2] : []), ...allowedCounts].map(String);
    const allowed = new Intl.ListFormat(locale, { type: "disjunction" }).format(sizes);
    return { status: 400, body: { error: t("searchBatchSize", { allowed }) } };
  }
  if (!minReviews.valid || !maxReviews.valid || !minRating.valid ||
      (minReviews.value !== undefined && !Number.isInteger(minReviews.value)) ||
      (maxReviews.value !== undefined && !Number.isInteger(maxReviews.value)) ||
      !filterChoice(rawFilters.website) || !filterChoice(rawFilters.phone) || !filterChoice(rawFilters.email) ||
      (minReviews.value !== undefined && maxReviews.value !== undefined && minReviews.value > maxReviews.value)) {
    return { status: 400, body: { error: t("searchFilters") } };
  }

  // Ubicación validada contra el dataset de /api/geography (nombres o códigos): a Apify solo llegan nombres canónicos,
  // nunca texto libre que el actor ignore y termine buscando en cualquier país.
  const countryCodeByName = new Map<string, string>();
  let target: Omit<ResolvedLocation, "countryCode"> = { country, province, district };
  if (!random) {
    let resolutions: LocationResolution[];
    try {
      resolutions = await Promise.all(multiCountry
        ? chosenCountries.map((value) => resolveLocation(value, "", ""))
        : [resolveLocation(country, province, district)]);
      // Only the country is strict: Leadtita passes free-text places (neighbourhoods, a city as province).
      // An unknown province/district travels as typed; the countryCode filter below still drops other countries.
      const single = resolutions[0];
      if (!multiCountry && !single.ok && single.field !== "country") {
        const fallback = await resolveLocation(country, single.field === "district" ? province : "", "");
        if (fallback.ok) {
          const known = fallback.location;
          resolutions = [{ ok: true, location: { ...known, province: known.province || province, district } }];
        }
      }
    } catch (error) {
      console.error("Geography lookup failed:", error instanceof Error ? error.message : "unknown");
      return { status: 503, body: { error: t("geoLoadFailed") } };
    }
    for (const resolution of resolutions) {
      if (!resolution.ok) return { status: 400, body: { error: t(locationErrorKeys[resolution.field]) } };
      countryCodeByName.set(resolution.location.country, resolution.location.countryCode);
      target = resolution.location;
    }
    if (multiCountry) target = { country: countriesLabel([...countryCodeByName.keys()]), province: "", district: "" };
  }
  const searchCountries: readonly string[] | null = random ? RANDOM_LOCATION_COUNTRIES : multiCountry ? [...countryCodeByName.keys()] : null;
  // Fuera del modo aleatorio se descartan lugares de otro país (si el actor informa `countryCode`): no se guardan ni se cobran.
  const expectedCountryCode = (searchCountry: string) => random ? "" : countryCodeByName.get(searchCountry) ?? "";

  const location = [target.district, target.province, target.country].filter(Boolean).join(", ");
  const monitorFor = (place: string) => {
    const normalizedLocation = place.normalize("NFKD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim().toLowerCase();
    return `leadta-${createHash("sha256").update([user.id, normalizedLocation, "es"].join("|")).digest("hex").slice(0, 24)}`;
  };
  const monitorName = monitorFor(location);
  let currentBatchId: string | null = null;
  let persistedCount = 0;
  let creditReservation: Awaited<ReturnType<typeof reserveLeadCredits>> | null = null;
  // Top-up state: the existing batch's counts before this run, and whether its result_count already includes this run.
  let topUpBase: { requested: number; results: number } | null = null;
  let topUpCounted = false;

  try {
    // El lote de 1 lead es solo para la primera búsqueda guiada: cada corrida tiene costo fijo de Apify.
    if (!topUp && count === 1 && !allowSmallBatches) {
      const own = encodeURIComponent(`user = "${user.id}"`);
      const previous = await pocketBaseFetch<{ items: unknown[] }>(`/api/collections/lead_batches/records?page=1&perPage=1&skipTotal=1&filter=${own}`);
      if (previous.items.length > 0) {
        return { status: 400, body: { error: t("searchFirstOnly") } };
      }
    }
    // Campaign discount read once: the same rate reserves `count` and charges what gets persisted.
    const { cost } = await featurePricing("lead_search", CREDITS_PER_LEAD);
    // The reservation's per-user lock also serializes top-ups of the same batch (round check + claim below).
    creditReservation = await reserveLeadCredits(user.id, count, topUp && topUpFree ? () => 0 : cost);
    let batchId: string;
    const knownUrls = new Set<string>();
    if (topUp) {
      const own = encodeURIComponent(`id = "${topUpBatchId}" && user = "${user.id}"`);
      const found = await pocketBaseFetch<{ items: { id: string; requested_count?: number; result_count?: number; topup_rounds?: number }[] }>(
        `/api/collections/lead_batches/records?page=1&perPage=1&skipTotal=1&fields=id,requested_count,result_count,topup_rounds&filter=${own}`,
      );
      const existing = found.items[0];
      if (!existing) return { status: 400, body: { error: t("invalidRequestBody") } };
      const requested = existing.requested_count ?? 0;
      const results = existing.result_count ?? 0;
      const empty = (missing: number): ApiResult => ({ status: 200, body: { batchId: existing.id, leads: [], creditsUsed: 0, replayed: true, requested, missing, round: topUpRound }, refreshSession: true });
      // A card whose round already ran (or the batch is already full) is a replay: nothing searched, nothing charged.
      if ((existing.topup_rounds ?? 0) !== topUpRound - 1) return empty(Math.max(0, requested - results));
      if (!waVerify) count = Math.min(count, requested - results);
      if (count <= 0) return empty(0);
      if (topUpFree && !waVerify && !isFreeTopUp(topUpRound, count)) return { status: 400, body: { error: t("invalidRequestBody") } };
      await pocketBaseFetch(`/api/collections/lead_batches/records/${existing.id}`, { method: "PATCH", body: JSON.stringify({ topup_rounds: topUpRound }) });
      const ownLeads = encodeURIComponent(`batch = "${existing.id}"`);
      const previous = await pocketBaseFetch<{ items: { maps_url?: string }[] }>(`/api/collections/leads/records?perPage=150&skipTotal=1&fields=maps_url&filter=${ownLeads}`);
      for (const item of previous.items) if (item.maps_url) knownUrls.add(item.maps_url);
      batchId = existing.id;
      topUpBase = { requested, results };
    } else {
      const batch = await pocketBaseFetch<{ id: string }>("/api/collections/lead_batches/records", {
        method: "POST",
        body: JSON.stringify({
          keywords,
          country: target.country,
          province: target.province,
          district: target.district,
          user: user.id,
          requested_count: count,
          result_count: 0,
          status: "running",
          created_at: new Date().toISOString(),
          ...(cardKey ? { card_key: cardKey } : {}),
        }),
      });
      currentBatchId = batchId = batch.id;
    }

    const leads = new Map<string, ReturnType<typeof mapPlace>>();
    let actorError = "";
    // WhatsApp replacement: ask for several places per lead needed (most candidates have no WhatsApp), min 15.
    let searchTarget = waVerify ? Math.min(150, Math.max(15, count * 5)) : count;
    const tried = new Set<string>();

    const addPlaces = (places: ActorPlace[], countryCode: string) => {
      for (const actorPlace of places) {
        const placeCountry = asText(actorPlace.countryCode).toUpperCase();
        if (countryCode && placeCountry && placeCountry !== countryCode) continue;
        const mapped = mapPlace(actorPlace);
        if (!mapped.name) continue;
        if (filters.email === "without" && mapped.email) continue;
        if (!matchesLeadRules(mapped, rules)) continue;
        if (mapped.maps_url && knownUrls.has(mapped.maps_url)) continue;
        if (waVerify && (tried.has(mapped.source_key) || !whatsAppDigits(mapped.phone))) continue;
        leads.set(mapped.source_key, mapped);
        if (leads.size >= searchTarget) break;
      }
    };

    const fillLeads = async () => {
      if (searchCountries) {
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
        const plan = planRandomSearch(searchTarget, keywords, Math.floor(Math.random() * searchCountries.length), searchCountries);
        const firstPass = await runSlots(plan);
        for (const { slot, places } of firstPass) addPlaces(places, expectedCountryCode(slot.country));

        // Si faltan resultados, se pide más solo a los países/keywords que devolvieron todo lo pedido (todavía tienen), sin pasar de `searchTarget`.
        const missing = searchTarget - leads.size;
        const saturated = firstPass.filter(({ slot, places, failed }) => !failed && places.length >= slot.limit);
        if (missing > 0 && saturated.length > 0 && remainingCallTimeoutMs(Date.now() - startedAt) > 0) {
          const extras = splitEvenly(Math.min(missing, saturated.length * 5), saturated.length);
          const secondPass = await runSlots(saturated.flatMap(({ slot }, index) => extras[index] > 0 ? [{ ...slot, limit: slot.limit + extras[index] }] : []));
          for (const { slot, places } of secondPass) addPlaces(places, expectedCountryCode(slot.country));
        }

        // Con filtros, una búsqueda chica puede volver vacía o corta porque se descartó casi todo: un reintento con más lugares.
        const short = firstPass.filter(({ slot, places, failed }) => !failed && places.length < slot.limit);
        if (filtered && leads.size < searchTarget && short.length > 0 && remainingCallTimeoutMs(Date.now() - startedAt) > 0) {
          const retry = await runSlots(short.map(({ slot }) => ({ ...slot, limit: filterRetryLimit(slot.limit) })));
          for (const { slot, places } of retry) addPlaces(places, expectedCountryCode(slot.country));
        }
      } else {
        for (const keyword of keywords) {
          const remaining = searchTarget - leads.size;
          if (remaining <= 0) break;

          try {
            const places = await actorSearch(token, keyword, location, remaining, monitorName, filters);
            addPlaces(places, expectedCountryCode(target.country));
          } catch (error) {
            actorError = uiError(error instanceof Error ? error.message : t("searchApifyFailed"), t("generic"));
            break;
          }
        }

        // Con filtros, si faltan resultados: un reintento por keyword pidiendo más lugares (los repetidos se deduplican).
        if (filtered && !actorError && leads.size < searchTarget && Date.now() - startedAt < FILTER_RETRY_BEFORE_MS) {
          for (const keyword of keywords) {
            const remaining = searchTarget - leads.size;
            if (remaining <= 0) break;
            try {
              addPlaces(await actorSearch(token, keyword, location, filterRetryLimit(remaining), monitorName, filters), expectedCountryCode(target.country));
            } catch (error) {
              actorError = uiError(error instanceof Error ? error.message : t("searchApifyFailed"), t("generic"));
              break;
            }
          }
        }
      }
    };

    if (!waVerify) await fillLeads();
    else {
      // Many candidates have no WhatsApp (landlines): search more places, verify them, and repeat with fresh ones until enough pass.
      const verified = new Map<string, ReturnType<typeof mapPlace>>();
      for (let round = 0; round < WA_MAX_ROUNDS; round++) {
        leads.clear();
        await fillLeads();
        const entries = [...leads.entries()];
        if (!entries.length) break;
        const checked = await checkWhatsAppNumbers(entries.map(([, lead]) => whatsAppDigits(lead.phone)));
        for (const [key, lead] of entries) {
          tried.add(key);
          if (verified.size < count && checked.get(whatsAppDigits(lead.phone)) === true) verified.set(key, lead);
        }
        if (verified.size >= count || actorError || Date.now() - startedAt > WA_ROUND_BEFORE_MS) break;
        searchTarget = Math.min(150, Math.max(15, (count - verified.size) * 5));
      }
      leads.clear();
      for (const [key, lead] of verified) leads.set(key, lead);
    }

    // PocketBase date format; this run's leads are the batch's leads created from here on.
    const runStart = new Date().toISOString().replace("T", " ");
    const leadCost = topUp && topUpFree ? 0 : cost(1);
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
      credit_cost: leadCost,
      ...(waVerify ? { whatsapp_status: "verified" } : {}),
      created_at: new Date().toISOString(),
    }));
    let persistenceError = "";
    try {
      const persistence = await createLeadRecords(batchId, records);
      persistedCount = persistence.created;
      if (persistence.failed > 0) persistenceError = uiError(t("searchSaveSomeFailedDetail"), t("searchSaveSomeFailed"));
    } catch {
      persistenceError = uiError(t("searchSaveFailedDetail"), t("searchSaveFailed"));
    }

    const shortfall = leads.size < count;
    const hasError = Boolean(actorError || persistenceError);
    const status = hasError ? (persistedCount > 0 ? "partial" : "failed") : "completed";
    // A top-up only adds to the existing batch: its status and requested_count stay as they were.
    await pocketBaseFetch(`/api/collections/lead_batches/records/${batchId}`, {
      method: "PATCH",
      body: JSON.stringify(topUp ? { "result_count+": persistedCount } : { result_count: persistedCount, status }),
    });
    topUpCounted = true;
    const credits = await creditReservation.settle(persistedCount);

    const filter = encodeURIComponent(topUp ? `batch = "${batchId}" && created_at >= "${runStart}"` : `batch = "${batchId}"`);
    const saved = await pocketBaseFetch<{ items: Record<string, unknown>[] }>(
      `/api/collections/leads/records?perPage=${Math.max(1, persistedCount)}&skipTotal=1&sort=created_at&filter=${filter}`,
    );
    const requested = topUpBase ? topUpBase.requested : count;
    return {
      status: 200,
      body: {
        batchId,
        leads: saved.items,
        status,
        credits,
        creditsUsed: leadCost === 0 ? 0 : cost(persistedCount),
        warning: [actorError, persistenceError].filter(Boolean).join(" ") || undefined,
        shortfall,
        requested,
        missing: Math.max(0, requested - (topUpBase?.results ?? 0) - persistedCount),
        ...(topUp ? { round: topUpRound } : {}),
      },
      refreshSession: true,
    };
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
    } else if (topUpBase && persistedCount > 0 && !topUpCounted) {
      // Never mark an existing batch failed; only count the leads this top-up did save (and charged for).
      await pocketBaseFetch(`/api/collections/lead_batches/records/${topUpBatchId}`, {
        method: "PATCH",
        body: JSON.stringify({ "result_count+": persistedCount }),
      }).catch(() => undefined);
    }
    if (error instanceof InsufficientCreditsError) {
      return { status: 402, body: { error: t("insufficientCredits", { required: error.required, available: error.available }), credits: error.available, required: error.required } };
    }
    if (error instanceof CreditOperationBusyError) {
      return { status: 409, body: { error: t("creditBusy") } };
    }
    console.error("Search failed:", error instanceof Error ? error.message : "unknown");
    const message = uiError(error instanceof Error ? error.message : t("searchFailedDetail"), t("searchFailed"));
    return { status: 502, body: { error: message, credits } };
  } finally {
    if (creditReservation) await creditReservation.release().catch(() => undefined);
  }
}
