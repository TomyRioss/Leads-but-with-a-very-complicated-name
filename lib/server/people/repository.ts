import { completenessOf, type PeopleSearchPlan, type PeopleSearchRequest, type PersonCandidate } from "@/lib/people";
import { createLeadRecords, pocketBaseFetch } from "@/lib/server/pocketbase";
import type { Lead, LeadBatch } from "@/lib/types";

const clip = (value: string | undefined, max: number) => (value ?? "").trim().slice(0, max);
const httpUrl = (value: string | undefined) => {
  const url = clip(value, 1000);
  return /^https?:\/\/\S+$/i.test(url) ? url : "";
};

// leads.source is a PocketBase select: serper|github|instagram|facebook|web. Newer scrapers are stored as "web";
// source_url still points at the real platform. ponytail: add the values with a migration when they must be filterable.
const STORED_SOURCES = new Set<PersonCandidate["source"]>(["serper", "github", "instagram", "facebook", "web"]);
const storedSource = (source: PersonCandidate["source"]) => (STORED_SOURCES.has(source) ? source : "web");

/** Same "network: url" lines that business leads store in `social_profiles`. */
function socialProfilesText(profiles: PersonCandidate["socialProfiles"]) {
  return Object.entries(profiles ?? {})
    .map(([network, url]) => [network, httpUrl(url)] as const)
    .filter(([, url]) => url)
    .map(([network, url]) => `${network}: ${url}`)
    .join("\n");
}

export async function createPeopleBatch(userId: string, req: PeopleSearchRequest, plan: PeopleSearchPlan): Promise<{ id: string }> {
  const location = clip(req.location || plan.location, 100);
  const batch = await pocketBaseFetch<{ id: string }>("/api/collections/lead_batches/records", {
    method: "POST",
    body: JSON.stringify({
      user: userId,
      kind: "person",
      query: clip(req.query, 300),
      plan,
      keywords: [clip(plan.role || req.query, 120)],
      // `country` is required on lead_batches; person searches keep the free-text location there.
      country: location || "-",
      province: "",
      district: "",
      requested_count: req.count,
      result_count: 0,
      status: "running",
      created_at: new Date().toISOString(),
    } satisfies Partial<LeadBatch> & { user: string }),
  });
  return { id: batch.id };
}

function toRecord(person: PersonCandidate) {
  return {
    kind: "person",
    name: clip(person.name, 255),
    category: clip(person.role, 500),
    role: clip(person.role, 120),
    address: clip(person.location, 1000),
    location: clip(person.location, 160),
    phone: clip(person.phone, 100),
    whatsapp: clip(person.whatsapp, 40),
    email: clip(person.email, 500),
    website: httpUrl(person.website),
    social_profiles: socialProfilesText(person.socialProfiles),
    source: storedSource(person.source),
    source_url: httpUrl(person.sourceUrl),
    completeness: completenessOf(person, false),
    created_at: new Date().toISOString(),
  };
}

/** Persists the people as leads of the batch and returns the saved rows (one list query, no N+1). */
export async function savePeople(batchId: string, people: PersonCandidate[]): Promise<Lead[]> {
  if (people.length === 0) return [];
  const { created } = await createLeadRecords(batchId, people.map(toRecord));
  if (created === 0) return [];
  const filter = encodeURIComponent(`batch = ${JSON.stringify(batchId)}`);
  const saved = await pocketBaseFetch<{ items: Lead[] }>(
    `/api/collections/leads/records?perPage=${Math.min(500, Math.max(1, created))}&skipTotal=1&sort=created_at&filter=${filter}`,
  );
  return saved.items;
}

export async function finishPeopleBatch(batchId: string, status: LeadBatch["status"], resultCount: number): Promise<void> {
  await pocketBaseFetch(`/api/collections/lead_batches/records/${encodeURIComponent(batchId)}`, {
    method: "PATCH",
    body: JSON.stringify({ status, result_count: Math.max(0, Math.trunc(resultCount)) }),
  });
}
