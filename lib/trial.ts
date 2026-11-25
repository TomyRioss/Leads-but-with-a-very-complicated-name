// Free trial: accounts created from TRIAL_CUTOFF on can use Leadta TRIAL_DAYS days without a paid plan.
// Older accounts and owners keep the previous Free access with no end. Paid = a subscription in status "authorized".

export const TRIAL_DAYS = 7;
/** 2026-11-26 00:00 Buenos Aires. Accounts created before this have no trial end. */
export const TRIAL_CUTOFF = "2026-11-26T03:00:00.000Z";

export type TrialAccess = "ok" | "trial" | "expired";

/** ISO end of the trial for an account created at `created` (PocketBase "2026-11-26 10:00:00.000Z"), or "" when it has none. */
export function trialEndsAt(created: unknown): string {
  if (typeof created !== "string" || !created) return "";
  const at = Date.parse(created.replace(" ", "T"));
  if (!Number.isFinite(at) || at < Date.parse(TRIAL_CUTOFF)) return "";
  return new Date(at + TRIAL_DAYS * 24 * 60 * 60_000).toISOString();
}

/** Access of a non-owner account from its trial end and whether it pays. */
export function trialAccess(endsAt: string, paid: boolean, now = Date.now()): TrialAccess {
  if (!endsAt || paid) return "ok";
  return now < Date.parse(endsAt) ? "trial" : "expired";
}
