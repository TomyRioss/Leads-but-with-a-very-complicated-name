import type { OwnerIdentity } from "@/lib/server/owner";
import { pocketBaseFetch } from "@/lib/server/pocketbase";

export const ownerAuditActions = [
  "user.credits_set",
  "user.credits_add",
  "user.update",
  "user.delete",
  "subscription.assign",
  "subscription.status",
  "subscription.plan",
  "batch.delete",
  "campaign.create",
  "campaign.update",
  "campaign.delete",
  "user.view_conversation",
  "user.view_message",
] as const;
export type OwnerAuditAction = (typeof ownerAuditActions)[number];

export type OwnerAuditEntry = {
  action: OwnerAuditAction;
  targetType: "user" | "subscription" | "batch" | "campaign";
  targetId: string;
  targetLabel: string;
  /** Before → after values. Must never contain passwords or tokens. */
  details?: Record<string, unknown>;
};

/** Platform headers are overwritten by the host; the last `x-forwarded-for` hop is the nearest proxy. */
function clientIp(request: Request) {
  const platformIp = request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")?.trim();
  if (platformIp) return platformIp;
  const hops = request.headers.get("x-forwarded-for")?.split(",");
  return hops?.[hops.length - 1]?.trim() || "";
}

/**
 * Writes an audit entry. A failure is logged and never undoes the action that was already performed.
 * Returns whether the entry was stored, so read-access routes can refuse to disclose content when it was not.
 */
export async function recordOwnerAction(request: Request, owner: OwnerIdentity, entry: OwnerAuditEntry): Promise<boolean> {
  try {
    await pocketBaseFetch("/api/collections/owner_audit_log/records", {
      method: "POST",
      body: JSON.stringify({
        actor_email: owner.email.slice(0, 200),
        action: entry.action,
        target_type: entry.targetType,
        target_id: entry.targetId.slice(0, 40),
        target_label: entry.targetLabel.slice(0, 300),
        details: entry.details ?? {},
        ip: clientIp(request).slice(0, 64),
      }),
    });
    return true;
  } catch (error) {
    console.error("Owner audit log write failed:", error instanceof Error ? error.name : "unknown");
    return false;
  }
}
