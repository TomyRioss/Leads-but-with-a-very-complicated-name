import { createHmac, timingSafeEqual } from "node:crypto";

// Leadtita Staff (owner assistant): write kinds, the permission rule and signed proposal tokens.
// Pure apart from node:crypto so the selfcheck can import it directly.

export const OWNER_CHANGE_KINDS = [
  "adjust_credits",
  "update_user",
  "delete_user",
  "subscription_status",
  "close_feedback",
  "delete_batch",
  "create_blog_post",
  "update_blog_post",
  "delete_blog_post",
] as const;
export type OwnerChangeKind = (typeof OWNER_CHANGE_KINDS)[number];
export type OwnerPermission = "ask" | "skip" | "danger";
export type OwnerChangeArgs = Record<string, unknown>;

export const OWNER_PENDING_TTL_MS = 10 * 60_000;
const TOKEN_PREFIX = "oa1";

export const isOwnerChangeKind = (value: unknown): value is OwnerChangeKind => (OWNER_CHANGE_KINDS as readonly unknown[]).includes(value);
export const isOwnerPermission = (value: unknown): value is OwnerPermission => value === "ask" || value === "skip" || value === "danger";

/**
 * Whether a change always needs the owner's Yes/No in "skip" mode. Deletions, credit adjustments (including the
 * feedback reward), subscription changes and email changes always do; public blog content does too.
 * Unknown kinds default to needing a card.
 */
export function requiresCard(kind: string, args: OwnerChangeArgs): boolean {
  if (kind === "update_user") return typeof args.email === "string";
  if (kind === "create_blog_post") return args.status === "published";
  // Editing a live post, or publishing a draft, changes public content.
  if (kind === "update_blog_post") return args.status === "published" || (args.status === undefined && args.live === true);
  return true;
}

/** Client and server rule: does a proposal made under `permission` run without the Yes/No step? */
export function runsWithoutCard(permission: OwnerPermission, kind: string, args: OwnerChangeArgs) {
  return permission === "danger" || (permission === "skip" && !requiresCard(kind, args));
}

/**
 * Server gate for an automatic (no click) confirm. `auto` is what the client claims; `signedPermission` is the mode
 * the proposal was signed under, so a card proposed in "ask" can never be auto-run by claiming another mode later.
 * A confirm without `auto` is an explicit Yes and is always allowed.
 */
export function autoRunAllowed(auto: unknown, signedPermission: OwnerPermission, kind: string, args: OwnerChangeArgs) {
  if (auto === undefined || auto === null) return true;
  if (!isOwnerPermission(auto) || auto === "ask") return false;
  // A claim can only be as permissive as the signed mode ("skip" under a "danger" proposal is fine, not the reverse).
  if (signedPermission === "ask" || (auto === "danger" && signedPermission !== "danger")) return false;
  return runsWithoutCard(auto, kind, args);
}

// ---------- Signed proposals ----------

export type OwnerPendingPayload = {
  v: 1;
  aud: "owner-assistant";
  uid: string;
  kind: OwnerChangeKind;
  args: OwnerChangeArgs;
  perm: OwnerPermission;
  iat: number;
  exp: number;
};

function signingKey() {
  // Same server secret as user Leadtita, derived with a distinct purpose: neither assistant accepts the other's tokens.
  const secret = process.env.EMAIL_VERIFICATION_SECRET || process.env.POCKETBASE_SUPERUSER_PASSWORD;
  if (!secret) throw new Error("No server secret configured to sign owner assistant changes.");
  return createHmac("sha256", secret).update("leadta:owner-assistant-pending-change:v1").digest();
}

const sign = (body: string) => createHmac("sha256", signingKey()).update(`${TOKEN_PREFIX}.${body}`).digest("base64url");

export function signOwnerChange(input: { uid: string; kind: OwnerChangeKind; args: OwnerChangeArgs; perm: OwnerPermission }, now = Date.now()) {
  const payload: OwnerPendingPayload = { v: 1, aud: "owner-assistant", ...input, iat: now, exp: now + OWNER_PENDING_TTL_MS };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${TOKEN_PREFIX}.${body}.${sign(body)}`;
}

/** Signature, audience, owner binding, expiry and kind. Arguments are re-validated by the caller before executing. */
export function verifyOwnerChange(token: unknown, ownerId: string, now = Date.now()): OwnerPendingPayload | null {
  if (typeof token !== "string" || token.length > 200_000) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX || !parts[1] || !parts[2]) return null;
  const expected = Buffer.from(sign(parts[1]));
  const given = Buffer.from(parts[2]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  let payload: OwnerPendingPayload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload || payload.v !== 1 || payload.aud !== "owner-assistant" || payload.uid !== ownerId) return null;
  if (typeof payload.iat !== "number" || typeof payload.exp !== "number" || payload.exp < now || payload.iat > now + 60_000) return null;
  if (!isOwnerChangeKind(payload.kind) || !isOwnerPermission(payload.perm)) return null;
  if (!payload.args || typeof payload.args !== "object" || Array.isArray(payload.args)) return null;
  return payload;
}
