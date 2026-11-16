import type { OwnerIdentity } from "@/lib/server/owner";
import { recordOwnerAction } from "@/lib/server/owner-audit";
import { pocketBaseFetch } from "@/lib/server/pocketbase";
import { sendFeedbackThanksEmail } from "@/lib/server/email";
import { getFeedbackIssue, setFeedbackIssueState } from "@/lib/server/linear";
import {
  countRecords,
  filterString,
  findUserSummary,
  isNotFound,
  maxCredits,
  OwnerCreditsBusyError,
  updateUserCredits,
  type SubscriptionRecord,
} from "@/app/api/owner/_shared";

// Owner write operations shared by the owner API routes and the Leadtita Staff confirm endpoint.
// Each one performs the write and its audit entry; failures carry the Errors.* message key and HTTP status.

/** `code: "stale"` = the record no longer matches what the caller expected (already applied or changed since). */
export type OwnerActionFailure = { ok: false; status: number; error: string; code?: "stale" };
export type OwnerActionResult<T> = { ok: true; value: T } | OwnerActionFailure;

const fail = (status: number, error: string, code?: "stale"): OwnerActionFailure => ({ ok: false, status, error, ...(code ? { code } : {}) });
const stale = () => fail(409, "generic", "stale");

export const FEEDBACK_REWARD_CREDITS = 50;
export const OWNER_SUBSCRIPTION_STATUSES = ["authorized", "paused", "cancelled"] as const;
export type OwnerSubscriptionStatus = (typeof OWNER_SUBSCRIPTION_STATUSES)[number];

// ---------- Users ----------

export type UserProfileChanges = { name?: string; email?: string; phone?: string };

/** Validates the profile fields of a users PATCH body (same rules as registration storage). */
export function parseUserProfileChanges(body: Record<string, unknown>): OwnerActionResult<UserProfileChanges> {
  const changes: UserProfileChanges = {};
  if (body.name !== undefined) {
    if (typeof body.name !== "string" || body.name.trim().length > 100) return fail(400, "ownerNameTooLong");
    changes.name = body.name.trim();
  }
  if (body.email !== undefined) {
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 200) return fail(400, "invalidEmail");
    changes.email = email;
  }
  if (body.phone !== undefined) {
    // Same free-text storage as registration; the column holds at most 30 characters.
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    if (typeof body.phone !== "string" || phone.length > 30 || !/^[0-9+().\- ]*$/.test(phone)) return fail(400, "ownerPhoneFormat");
    changes.phone = phone;
  }
  return { ok: true, value: changes };
}

export async function updateOwnerUserProfile(request: Request, owner: OwnerIdentity, id: string, changes: UserProfileChanges): Promise<OwnerActionResult<UserProfileChanges>> {
  try {
    const user = await findUserSummary(id);
    if (!user) return fail(404, "ownerUserNotFound");
    const current: Record<string, string> = { name: user.name || "", email: user.email, phone: user.phone || "" };
    const changed = Object.entries(changes).filter(([field, value]) => value !== current[field]);
    if (changed.some(([field]) => field === "email") && (user.role === "owner" || user.id === owner.id)) return fail(403, "ownerEmailLocked");
    if (changed.length > 0) {
      const patch = Object.fromEntries(changed);
      try {
        await pocketBaseFetch(`/api/collections/users/records/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
      } catch (error) {
        if (error instanceof Error && error.message.includes("validation_not_unique")) return fail(409, "ownerEmailInUse");
        throw error;
      }
      await recordOwnerAction(request, owner, {
        action: "user.update",
        targetType: "user",
        targetId: id,
        targetLabel: changes.email ?? user.email,
        details: Object.fromEntries(changed.map(([field, value]) => [field, { before: current[field], after: value }])),
      });
    }
    return { ok: true, value: changes };
  } catch (error) {
    console.error("Owner user update failed:", error instanceof Error ? error.name : "unknown");
    return fail(502, "ownerUserUpdateFailed");
  }
}

export function isHalfStep(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value * 2);
}

/** Absolute balances must be >= 0; deltas may be negative. Both in 0.5 steps within ±maxCredits. */
export function isValidCreditAmount(mode: "set" | "add", amount: unknown): amount is number {
  return isHalfStep(amount) && Math.abs(amount) <= maxCredits && !(mode === "set" && amount < 0);
}

/**
 * Sets or adds credits under the shared credit lock and audits it. `expectBefore` (optional) makes the write
 * single-effect: it only applies while the balance is still exactly that value.
 */
export async function adjustOwnerUserCredits(
  request: Request,
  owner: OwnerIdentity,
  id: string,
  mode: "set" | "add",
  amount: number,
  options: { expectBefore?: number } = {},
): Promise<OwnerActionResult<{ credits: number; before: number }>> {
  try {
    const user = await findUserSummary(id);
    if (!user) return fail(404, "ownerUserNotFound");
    let before = 0;
    let mismatch = false;
    const credits = await updateUserCredits(id, (current) => {
      before = current;
      if (options.expectBefore !== undefined && current !== options.expectBefore) {
        mismatch = true;
        return null;
      }
      const next = mode === "set" ? amount : current + amount;
      return next >= 0 && next <= maxCredits ? next : null;
    });
    if (mismatch) return stale();
    if (credits === null) return fail(400, "ownerCreditsRange");
    await recordOwnerAction(request, owner, {
      action: mode === "set" ? "user.credits_set" : "user.credits_add",
      targetType: "user",
      targetId: id,
      targetLabel: user.email,
      details: { creditsBefore: before, creditsAfter: credits, ...(mode === "add" ? { delta: amount } : {}) },
    });
    return { ok: true, value: { credits, before } };
  } catch (error) {
    if (error instanceof OwnerCreditsBusyError) return fail(409, "ownerCreditsBusy");
    if (isNotFound(error)) return fail(404, "ownerUserNotFound");
    console.error("Owner credits update failed:", error instanceof Error ? error.name : "unknown");
    return fail(502, "ownerCreditsUpdateFailed");
  }
}

/** Deletes a non-owner account after the typed email matches it; related records cascade. Audits success and failure. */
export async function deleteOwnerUser(request: Request, owner: OwnerIdentity, id: string, confirmEmail: string): Promise<OwnerActionResult<{ batches: number; leads: number; subscriptions: number }>> {
  let user;
  try {
    user = await findUserSummary(id);
  } catch (error) {
    console.error("Owner user delete lookup failed:", error instanceof Error ? error.name : "unknown");
    return fail(502, "ownerUserDeleteFailed");
  }
  if (!user) return fail(404, "ownerUserNotFound");
  if (user.role === "owner" || user.id === owner.id) return fail(403, "ownerDeleteForbidden");
  if (confirmEmail.trim().toLowerCase() !== user.email.toLowerCase()) return fail(400, "ownerConfirmEmailMismatch");

  try {
    const [batches, leads, subscriptions] = await Promise.all([
      countRecords("lead_batches", `user = ${filterString(id)}`),
      countRecords("leads", `batch.user = ${filterString(id)}`),
      countRecords("subscriptions", `user = ${filterString(id)}`),
    ]);
    // lead_batches.user, leads.batch, subscriptions.user, subscription_payments.user and credit_locks.user all cascade on delete.
    await pocketBaseFetch(`/api/collections/users/records/${id}`, { method: "DELETE" });
    const deleted = { batches, leads, subscriptions };
    await recordOwnerAction(request, owner, {
      action: "user.delete",
      targetType: "user",
      targetId: id,
      targetLabel: user.email,
      details: { email: user.email, name: user.name || "", ...deleted },
    });
    return { ok: true, value: deleted };
  } catch (error) {
    console.error("Owner user delete failed:", error instanceof Error ? error.name : "unknown");
    await recordOwnerAction(request, owner, {
      action: "user.delete",
      targetType: "user",
      targetId: id,
      targetLabel: user.email,
      details: { status: "failed", reason: "delete_failed", email: user.email },
    });
    return fail(502, "ownerUserDeleteFailed");
  }
}

// ---------- Subscriptions ----------

/** Changes a subscription status (plans are managed by the external billing system). `expectBefore` = stored status the caller saw. */
export async function setOwnerSubscriptionStatus(
  request: Request,
  owner: OwnerIdentity,
  id: string,
  requestedStatus: OwnerSubscriptionStatus,
  options: { expectBefore?: string } = {},
): Promise<OwnerActionResult<{ status: string }>> {
  let subscription: SubscriptionRecord;
  try {
    subscription = await pocketBaseFetch<SubscriptionRecord>(`/api/collections/subscriptions/records/${id}`);
  } catch (error) {
    if (isNotFound(error)) return fail(404, "ownerSubscriptionNotFound");
    return fail(502, "ownerSubscriptionLoadFailed");
  }
  if (options.expectBefore !== undefined && subscription.status !== options.expectBefore) return stale();

  // Cancelled subscriptions are stored with the "canceled" spelling.
  const status = requestedStatus === "cancelled" ? "canceled" : requestedStatus;
  try {
    await pocketBaseFetch(`/api/collections/subscriptions/records/${subscription.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
  } catch (error) {
    console.error("Owner subscription save failed:", error instanceof Error ? error.name : "unknown");
    return fail(502, "ownerSubscriptionSaveFailed");
  }

  const account = await findUserSummary(subscription.user).catch(() => null);
  await recordOwnerAction(request, owner, {
    action: "subscription.status",
    targetType: "subscription",
    targetId: subscription.id,
    targetLabel: `${account?.email ?? subscription.user} · ${subscription.plan_id}`,
    details: { status: { before: subscription.status, after: status } },
  });
  return { ok: true, value: { status } };
}

// ---------- Feedback ----------

/**
 * Closes a feedback issue: moves it to Done in Linear, adds the reward credits to its author and emails the thanks.
 * The Linear state is the lock: a closed comment never pays twice. Callers check isLinearConfigured() first.
 */
export async function closeOwnerFeedback(request: Request, owner: OwnerIdentity, id: string): Promise<OwnerActionResult<{ credits: number; emailSent: boolean }>> {
  let feedback;
  try {
    feedback = await getFeedbackIssue(id);
  } catch (error) {
    console.error("Owner feedback lookup failed:", error instanceof Error ? error.message.slice(0, 200) : "unknown");
    return fail(502, "ownerFeedbackCloseFailed");
  }
  if (!feedback?.user) return fail(404, "ownerFeedbackNotFound");
  if (feedback.state === "closed") return fail(409, "ownerFeedbackAlreadyClosed");
  // The current email comes from the account (it may have changed); without an account there is no one to reward.
  const account = await findUserSummary(feedback.user.id).catch(() => null);
  if (!account) return fail(404, "ownerUserNotFound");
  const author = { ...feedback.user, email: account.email };

  // ponytail: two simultaneous closes of the same comment could add twice; the UI button locks while it runs.
  try {
    await setFeedbackIssueState(feedback.id, "closed");
  } catch (error) {
    console.error("Owner feedback close failed:", error instanceof Error ? error.message.slice(0, 200) : "unknown");
    return fail(502, "ownerFeedbackCloseFailed");
  }

  let before = 0;
  let credits: number | null;
  try {
    credits = await updateUserCredits(author.id, (current) => {
      before = current;
      const next = current + FEEDBACK_REWARD_CREDITS;
      return next <= maxCredits ? next : null;
    });
    if (credits === null) throw new Error("Credit limit reached.");
  } catch (error) {
    // Without the credits it does not stay closed: reopen so it can be retried.
    await setFeedbackIssueState(feedback.id, "open").catch(() => undefined);
    if (error instanceof OwnerCreditsBusyError) return fail(409, "ownerCreditsBusy");
    console.error("Owner feedback credits failed:", error instanceof Error ? error.message.slice(0, 200) : "unknown");
    return fail(502, "ownerFeedbackCloseFailed");
  }

  await recordOwnerAction(request, owner, {
    action: "user.credits_add",
    targetType: "user",
    targetId: author.id,
    targetLabel: author.email,
    details: { creditsBefore: before, creditsAfter: credits, delta: FEEDBACK_REWARD_CREDITS, reason: `feedback ${feedback.identifier}` },
  });

  let emailSent = true;
  try {
    await sendFeedbackThanksEmail({ to: author.email, locale: author.locale, credits: FEEDBACK_REWARD_CREDITS, issueId: feedback.id });
  } catch (error) {
    emailSent = false;
    console.error("Feedback thanks email failed:", error instanceof Error ? error.message.slice(0, 200) : "unknown");
  }
  return { ok: true, value: { credits, emailSent } };
}

// ---------- Lead batches ----------

type BatchRecord = { id: string; user?: string; keywords?: unknown; country?: string; province?: string; district?: string; status?: string; created_at?: string };

/** Deletes a search batch and (by cascade) its leads, unless it is still running. */
export async function deleteOwnerBatch(request: Request, owner: OwnerIdentity, id: string): Promise<OwnerActionResult<{ deletedLeads: number }>> {
  try {
    const batch = await pocketBaseFetch<BatchRecord>(`/api/collections/lead_batches/records/${id}`);
    // A search that is still running could keep writing leads (and charging credits) into the deleted batch.
    const startedAt = Date.parse(batch.created_at ?? "");
    if (batch.status === "running" && (!Number.isFinite(startedAt) || Date.now() - startedAt < 30 * 60 * 1000)) return fail(409, "ownerBatchRunning");
    const [deletedLeads, account] = await Promise.all([
      countRecords("leads", `batch = ${filterString(id)}`),
      batch.user ? findUserSummary(batch.user).catch(() => null) : null,
    ]);
    // leads.batch cascades on delete, so removing the batch removes its leads.
    await pocketBaseFetch(`/api/collections/lead_batches/records/${id}`, { method: "DELETE" });

    const keywords = Array.isArray(batch.keywords) ? batch.keywords.map(String) : [];
    const zone = [batch.district, batch.province, batch.country].filter(Boolean).join(", ");
    await recordOwnerAction(request, owner, {
      action: "batch.delete",
      targetType: "batch",
      targetId: id,
      targetLabel: `${keywords.join(", ")}${zone ? ` · ${zone}` : ""}`,
      details: { ownerEmail: account?.email ?? "", ownerId: batch.user ?? "", keywords, zone, status: batch.status ?? "", deletedLeads },
    });
    return { ok: true, value: { deletedLeads } };
  } catch (error) {
    if (isNotFound(error)) return fail(404, "ownerBatchNotFound");
    console.error("Owner batch delete failed:", error instanceof Error ? error.name : "unknown");
    return fail(502, "ownerBatchDeleteFailed");
  }
}
