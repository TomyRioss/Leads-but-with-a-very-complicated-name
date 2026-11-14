import { pocketBaseFetch } from "@/lib/server/pocketbase";

export const SERVICE_OFFERING_MAX = 300;
export const COMMERCIAL_SECTORS_MAX = 300;

export type CommercialProfile = { serviceOffering: string; commercialSectors: string };
type ProfileRecord = { service_offering?: unknown; commercial_sectors?: unknown };

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** Sectors are stored as one comma-separated string; dedupes and trims each entry. */
function cleanSectors(value: unknown) {
  const items = clean(value, 1000).split(",").map((item) => item.trim()).filter(Boolean);
  return [...new Map(items.map((item) => [item.toLowerCase(), item])).values()].join(", ").slice(0, COMMERCIAL_SECTORS_MAX);
}

function toProfile(record: ProfileRecord | null | undefined): CommercialProfile {
  return {
    serviceOffering: clean(record?.service_offering, SERVICE_OFFERING_MAX),
    commercialSectors: cleanSectors(record?.commercial_sectors),
  };
}

export async function getCommercialProfile(userId: string) {
  const record = await pocketBaseFetch<ProfileRecord>(`/api/collections/users/records/${encodeURIComponent(userId)}?fields=service_offering,commercial_sectors`);
  return toProfile(record);
}

/** Updates only the fields present in `input`; an empty string clears the field. */
export async function updateCommercialProfile(userId: string, input: { serviceOffering?: unknown; commercialSectors?: unknown }) {
  const body: Record<string, string> = {};
  if (input.serviceOffering !== undefined) body.service_offering = clean(input.serviceOffering, SERVICE_OFFERING_MAX);
  if (input.commercialSectors !== undefined) body.commercial_sectors = cleanSectors(input.commercialSectors);
  if (!Object.keys(body).length) return getCommercialProfile(userId);
  const record = await pocketBaseFetch<ProfileRecord>(`/api/collections/users/records/${encodeURIComponent(userId)}?fields=service_offering,commercial_sectors`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  return toProfile(record);
}
