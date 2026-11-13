import { randomBytes } from "node:crypto";

// Lazy import keeps the pure helpers loadable by plain node (scripts/referrals-selfcheck.mjs) without the "@/" alias.
async function pocketBaseFetch<T>(path: string, init?: RequestInit) {
  return (await import("@/lib/server/pocketbase")).pocketBaseFetch<T>(path, init);
}

export const REFERRER_CREDITS = 50;
export const REFERRED_CREDITS = 25;
export const MAX_REWARDS_PER_MONTH = 20;
export const REFERRAL_COOKIE = "leadta_ref";
export const REFERRAL_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

// Crockford base32 (no I, L, O, U): 8 chars = 40 random bits, not guessable.
const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const codePattern = /^[0-9A-HJKMNP-TV-Z]{8}$/;

export type RewardDecision = "reward" | "skip" | "reject_monthly_cap";

export function generateReferralCode() {
  return Array.from(randomBytes(8), (byte) => alphabet[byte & 31]).join("");
}

export function isValidReferralCode(value: unknown): value is string {
  return typeof value === "string" && codePattern.test(value);
}

/** Lowercase, drop "+tag", and ignore dots for Gmail so aliases of one mailbox compare equal. */
export function normalizeEmail(email: string) {
  const [rawLocal = "", rawDomain = ""] = email.trim().toLowerCase().split("@");
  const domain = rawDomain === "googlemail.com" ? "gmail.com" : rawDomain;
  let local = rawLocal.split("+")[0];
  if (domain === "gmail.com") local = local.replaceAll(".", "");
  return `${local}@${domain}`;
}

/** No self-referral and no alias of the referrer's own mailbox. */
export function canRefer(referrer: { id: string; email: string }, referred: { id: string; email: string }) {
  return referrer.id !== referred.id && normalizeEmail(referrer.email) !== normalizeEmail(referred.email);
}

/** Idempotent: only a pending referral can be rewarded, and the referrer's monthly cap turns the excess into a rejection. */
export function rewardDecision(status: string, rewardedThisMonth: number): RewardDecision {
  if (status !== "pending") return "skip";
  return rewardedThisMonth >= MAX_REWARDS_PER_MONTH ? "reject_monthly_cap" : "reward";
}

export function monthStartIso(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().replace("T", " ");
}

export function maskEmail(email: string) {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}

type UserRef = { id: string; email: string; referral_code?: string };
type ReferralRecord = { id: string; referrer: string; status: string };
type List<T> = { items: T[]; totalItems?: number };

function appOrigin() {
  const configured = process.env.APP_URL?.trim() || (process.env.VERCEL ? "https://leadta.app" : "http://localhost:3000");
  return new URL(configured).origin;
}

export function referralLink(code: string) {
  return `${appOrigin()}/buscar?ref=${code}`;
}

const userPath = (id: string) => `/api/collections/users/records/${encodeURIComponent(id)}`;
const listPath = (collection: string, params: Record<string, string>) => `/api/collections/${collection}/records?${new URLSearchParams(params).toString()}`;
const quote = (value: string) => JSON.stringify(value);

/** Lazily generates the code; retries on the (unlikely) unique collision. */
export async function getOrCreateReferralCode(userId: string) {
  const user = await pocketBaseFetch<UserRef>(`${userPath(userId)}?fields=id,email,referral_code`);
  if (user.referral_code) return user.referral_code;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateReferralCode();
    try {
      await pocketBaseFetch(userPath(userId), { method: "PATCH", body: JSON.stringify({ referral_code: code }) });
      return code;
    } catch (error) {
      const current = await pocketBaseFetch<UserRef>(`${userPath(userId)}?fields=referral_code`);
      if (current.referral_code) return current.referral_code;
      if (attempt === 4) throw error;
    }
  }
  throw new Error("Couldn't generate a referral code.");
}

/** Links a brand-new user to the referrer behind `code`. Never throws: a referral problem must not block signup. */
export async function attachReferral(referred: { id: string; email: string }, code: unknown) {
  if (!isValidReferralCode(code)) return false;
  try {
    const found = await pocketBaseFetch<List<UserRef>>(listPath("users", { filter: `referral_code = ${quote(code)}`, perPage: "1", fields: "id,email" }));
    const referrer = found.items[0];
    if (!referrer || !canRefer(referrer, referred)) return false;
    // The unique index on referrals.referred enforces "referred only once".
    await pocketBaseFetch("/api/collections/referrals/records", {
      method: "POST",
      body: JSON.stringify({ referrer: referrer.id, referred: referred.id, status: "pending", referrer_credits: 0, referred_credits: 0 }),
    });
    await pocketBaseFetch(userPath(referred.id), { method: "PATCH", body: JSON.stringify({ referred_by: referrer.id }) });
    return true;
  } catch (error) {
    console.error("Leadta referral attach failed:", error instanceof Error ? error.message : "unknown error");
    return false;
  }
}

/** Called when `referredId` verifies their email. Safe to call repeatedly: only a pending referral pays out. */
export async function rewardReferral(referredId: string, now = new Date()) {
  const pending = await pocketBaseFetch<List<ReferralRecord>>(
    listPath("referrals", { filter: `referred = ${quote(referredId)} && status = "pending"`, perPage: "1", fields: "id,referrer,status" }),
  );
  const referral = pending.items[0];
  if (!referral) return "skip" as RewardDecision;

  const monthly = await pocketBaseFetch<List<ReferralRecord>>(
    listPath("referrals", { filter: `referrer = ${quote(referral.referrer)} && status = "rewarded" && rewarded_at >= ${quote(monthStartIso(now))}`, perPage: "1", fields: "id" }),
  );
  const decision = rewardDecision(referral.status, monthly.totalItems ?? monthly.items.length);
  const recordPath = `/api/collections/referrals/records/${referral.id}`;

  if (decision === "reject_monthly_cap") {
    await pocketBaseFetch(recordPath, { method: "PATCH", body: JSON.stringify({ status: "rejected", reject_reason: "monthly_cap" }) });
    return decision;
  }
  if (decision !== "reward") return decision;

  // Claim first so a repeated call finds nothing pending; credits use PocketBase's atomic "credits+" increment.
  await pocketBaseFetch(recordPath, {
    method: "PATCH",
    body: JSON.stringify({ status: "rewarded", rewarded_at: now.toISOString(), referrer_credits: REFERRER_CREDITS, referred_credits: REFERRED_CREDITS }),
  });
  try {
    await pocketBaseFetch(userPath(referral.referrer), { method: "PATCH", body: JSON.stringify({ "credits+": REFERRER_CREDITS }) });
  } catch (error) {
    await pocketBaseFetch(recordPath, { method: "PATCH", body: JSON.stringify({ status: "pending", rewarded_at: "", referrer_credits: 0, referred_credits: 0 }) }).catch(() => undefined);
    throw error;
  }
  await pocketBaseFetch(userPath(referredId), { method: "PATCH", body: JSON.stringify({ "credits+": REFERRED_CREDITS }) })
    .catch((error) => console.error("Leadta referral: referred credits failed:", error instanceof Error ? error.message : "unknown error"));
  return decision;
}

type SummaryRow = { id: string; status: string; created: string; rewarded_at?: string; referrer_credits?: number; expand?: { referred?: { email?: string } } };

export async function getReferralSummary(userId: string, page: number, perPage = 10) {
  const code = await getOrCreateReferralCode(userId);
  const base = `referrer = ${quote(userId)}`;
  const [items, rewarded] = await Promise.all([
    pocketBaseFetch<List<SummaryRow>>(listPath("referrals", { filter: base, sort: "-created", page: String(page), perPage: String(perPage), expand: "referred", fields: "id,status,created,rewarded_at,referrer_credits,expand.referred.email" })),
    pocketBaseFetch<List<SummaryRow>>(listPath("referrals", { filter: `${base} && status = "rewarded"`, perPage: "500", fields: "referrer_credits" })),
  ]);
  return {
    code,
    link: referralLink(code),
    invited: items.totalItems ?? items.items.length,
    rewarded: rewarded.totalItems ?? rewarded.items.length,
    creditsEarned: rewarded.items.reduce((sum, row) => sum + (row.referrer_credits ?? 0), 0),
    page,
    items: items.items.map((row) => ({ id: row.id, status: row.status, created: row.created, rewardedAt: row.rewarded_at || null, email: maskEmail(row.expand?.referred?.email ?? "") })),
  };
}
