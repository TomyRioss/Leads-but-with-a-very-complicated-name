import { NextResponse } from "next/server";
import { CAMPAIGN_FEATURES, isCampaignFeature, type Campaign, type CampaignFeature } from "@/lib/campaigns";
import type { OwnerIdentity } from "@/lib/server/owner";
import { recordOwnerAction, type OwnerAuditAction } from "@/lib/server/owner-audit";
import { errorTranslator } from "@/lib/server/locale";
import { pocketBaseDate } from "../_shared";

export type CampaignInput = Omit<Campaign, "id">;
export type CampaignField = keyof CampaignInput;

const fields: CampaignField[] = ["name", "label", "message", "discountPercent", "allFeatures", "features", "startsAt", "endsAt", "active"];

const trimmed = (value: unknown, min: number, max: number) => {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length >= min && text.length <= max ? text : null;
};

const isoDate = (value: unknown) => {
  if (typeof value !== "string" || value.length > 40) return null;
  const time = Date.parse(value.replace(" ", "T"));
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
};

/**
 * Validates `body` merged over `base` (the stored campaign on PATCH). Returns the full input or the first invalid field.
 * Only known keys present in `body` are read; on create every field except `label` must be present.
 */
export function parseCampaignInput(body: Record<string, unknown>, base?: CampaignInput): { input: CampaignInput } | { field: CampaignField | "body" } {
  const has = (key: CampaignField) => body[key] !== undefined;
  if (base && !fields.some(has)) return { field: "body" };
  const pick = <T>(key: CampaignField, parse: (value: unknown) => T | null, fallback: T | undefined): T | null =>
    has(key) ? parse(body[key]) : fallback ?? null;

  const name = pick("name", (value) => trimmed(value, 1, 120), base?.name);
  if (name === null) return { field: "name" };
  const label = pick("label", (value) => trimmed(value, 0, 40), base?.label ?? "");
  if (label === null) return { field: "label" };
  const message = pick("message", (value) => trimmed(value, 1, 200), base?.message);
  if (message === null) return { field: "message" };
  const discountPercent = pick("discountPercent", (value) => (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 100 ? value : null), base?.discountPercent);
  if (discountPercent === null) return { field: "discountPercent" };
  const allFeatures = pick("allFeatures", (value) => (typeof value === "boolean" ? value : null), base?.allFeatures);
  if (allFeatures === null) return { field: "allFeatures" };
  const features = pick("features", (value) => (
    Array.isArray(value) && value.length <= CAMPAIGN_FEATURES.length * 2 && value.every(isCampaignFeature)
      ? CAMPAIGN_FEATURES.filter((feature) => (value as CampaignFeature[]).includes(feature))
      : null
  ), base?.features ?? []);
  if (features === null) return { field: "features" };
  // Exactly one scope: every feature, or a non-empty subset.
  if (allFeatures === (features.length > 0)) return { field: "features" };
  const startsAt = pick("startsAt", isoDate, base?.startsAt ? isoDate(base.startsAt) ?? undefined : undefined);
  if (startsAt === null) return { field: "startsAt" };
  const endsAt = pick("endsAt", isoDate, base?.endsAt ? isoDate(base.endsAt) ?? undefined : undefined);
  if (endsAt === null || Date.parse(startsAt) >= Date.parse(endsAt)) return { field: "endsAt" };
  const active = pick("active", (value) => (typeof value === "boolean" ? value : null), base?.active ?? false);
  if (active === null) return { field: "active" };

  return { input: { name, label, message, discountPercent, allFeatures, features, startsAt, endsAt, active } };
}

export function toRecordBody(input: CampaignInput) {
  return {
    name: input.name,
    label: input.label,
    message: input.message,
    discount_percent: input.discountPercent,
    all_features: input.allFeatures,
    features: input.features,
    starts_at: pocketBaseDate(new Date(input.startsAt)),
    ends_at: pocketBaseDate(new Date(input.endsAt)),
    active: input.active,
  };
}

export function invalidField(request: Request, field: CampaignField | "body") {
  return NextResponse.json({ error: errorTranslator(request)("ownerInvalidData"), field }, { status: 400 });
}

type CampaignAuditAction = Extract<OwnerAuditAction, `campaign.${string}`>;

/** Owner audit entry for a campaign write. owner_audit_log stores action/target_type as free text. */
export function recordCampaignAction(request: Request, owner: OwnerIdentity, action: CampaignAuditAction, campaign: Campaign, details: Record<string, unknown>) {
  return recordOwnerAction(request, owner, { action, targetType: "campaign", targetId: campaign.id, targetLabel: campaign.name, details });
}

/** Audit details: every field for create/delete, only changed fields (before → after) for update. */
export function campaignDetails(input: CampaignInput, before?: CampaignInput) {
  if (!before) return Object.fromEntries(fields.map((key) => [key, input[key]]));
  const changed = fields.filter((key) => JSON.stringify(normalize(key, before[key])) !== JSON.stringify(normalize(key, input[key])));
  return Object.fromEntries(changed.map((key) => [key, { before: before[key], after: input[key] }]));
}

const normalize = (key: CampaignField, value: unknown) =>
  (key === "startsAt" || key === "endsAt") && typeof value === "string" ? isoDate(value) : value;
