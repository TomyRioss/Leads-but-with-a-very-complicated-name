// Custom lead filters (rules the search provider can't apply, e.g. "phone starts with +56") and the free top-up policy.
// Shared by /api/search (applied before saving, so dropped places are never charged) and Leadtita's batch filter.

export const LEAD_RULE_FIELDS = ["phone", "email", "website", "name", "category", "address"] as const;
export const LEAD_RULE_OPS = ["starts_with", "contains", "not_contains", "empty", "not_empty"] as const;
export const MAX_LEAD_RULES = 3;
const MAX_RULE_VALUE = 100;

export type LeadRuleField = (typeof LEAD_RULE_FIELDS)[number];
export type LeadRuleOp = (typeof LEAD_RULE_OPS)[number];
export type LeadRule = { field: LeadRuleField; op: LeadRuleOp; value: string };
export type RuleLead = Partial<Record<LeadRuleField, string>>;

const needsValue = (op: LeadRuleOp) => op === "starts_with" || op === "contains" || op === "not_contains";
const digits = (value: string) => value.replace(/\D/g, "");
const text = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
/** Phones compare by digits only: "+56 9 1234" and "56-9-1234" are the same number. */
const normalize = (field: LeadRuleField, value: string) => (field === "phone" ? digits(value) : text(value));

/**
 * Validates rules from the model, a signed card (JSON string) or a request body. Returns [] for no rules and null when
 * anything is invalid (never silently drops a rule: a dropped rule would keep leads the user asked to discard).
 */
export function parseLeadRules(raw: unknown): LeadRule[] | null {
  if (raw === undefined || raw === null || raw === "") return [];
  let list: unknown = raw;
  if (typeof raw === "string") {
    try { list = JSON.parse(raw); } catch { return null; }
  }
  if (!Array.isArray(list) || list.length > MAX_LEAD_RULES) return null;
  const rules: LeadRule[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") return null;
    const { field, op, value } = item as Record<string, unknown>;
    if (!(LEAD_RULE_FIELDS as readonly unknown[]).includes(field) || !(LEAD_RULE_OPS as readonly unknown[]).includes(op)) return null;
    const rule = { field, op } as LeadRule;
    if (needsValue(rule.op)) {
      if (typeof value !== "string" || !value.trim() || value.length > MAX_RULE_VALUE) return null;
      if (!normalize(rule.field, value)) return null; // "+" alone for a phone matches nothing useful
      rule.value = value.trim();
    } else rule.value = "";
    rules.push(rule);
  }
  return rules;
}

/** Every rule must hold (AND). No rules = keep everything. */
export function matchesLeadRules(lead: RuleLead, rules: LeadRule[]): boolean {
  return rules.every((rule) => {
    const current = normalize(rule.field, String(lead[rule.field] ?? ""));
    if (rule.op === "empty") return !current;
    if (rule.op === "not_empty") return Boolean(current);
    const wanted = normalize(rule.field, rule.value);
    if (rule.op === "starts_with") return current.startsWith(wanted);
    if (rule.op === "contains") return current.includes(wanted);
    return !current.includes(wanted);
  });
}

// ---------- Top-up policy ----------

/** Free top-ups per batch, and the shortfall below which they are free. */
export const FREE_TOPUP_MAX_ROUNDS = 2;
export const FREE_TOPUP_MAX_MISSING = 49;
/** Same cap as lead_batches.requested_count. */
export const TOPUP_MAX_MISSING = 150;

/**
 * `round` = the batch's topup_rounds + 1. Free only for search shortfalls (a batch filtered after delivery has its rounds
 * exhausted, so refunded leads are never replaced for free).
 */
export function isFreeTopUp(round: number, missing: number): boolean {
  return Number.isInteger(round) && round >= 1 && round <= FREE_TOPUP_MAX_ROUNDS && Number.isInteger(missing) && missing >= 1 && missing <= FREE_TOPUP_MAX_MISSING;
}
