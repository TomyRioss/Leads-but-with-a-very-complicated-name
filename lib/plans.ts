// Plans are data managed by an external billing system. Nothing here defines the catalog:
// callers pass in the plans they loaded (public ones plus any exclusive to a user).
// All externally agreed plans are monthly: price and credits renew every month, no annual option.

export const PLAN_PERIOD = "month" as const;

export type PlanVisibility = "public" | "private";

export type Plan = {
  id: string;
  name: string;
  priceArs: number;
  /** Credits granted on each monthly renewal. */
  credits: number;
  featured?: boolean;
  /** "private" plans never show on the public pricing page. */
  visibility: PlanVisibility;
  /** Only for private plans: the user the plan was created for. */
  userId?: string;
  period: typeof PLAN_PERIOD;
};

export type SubscriptionPlanId = string;

/** Public plans only (what the pricing page may list). */
export const publicPlans = (plans: readonly Plan[]) => plans.filter((plan) => plan.visibility === "public");

/** Public plans plus the private ones assigned to this user. */
export const plansForUser = (plans: readonly Plan[], userId: string | undefined) =>
  plans.filter((plan) => plan.visibility === "public" || (!!userId && plan.userId === userId));

/** True when the plan is private (exclusive to a user) in the given catalog. */
export const isExclusivePlan = (plans: readonly Plan[], id: string) => findPlan(plans, id)?.visibility === "private";

export const findPlan = (plans: readonly Plan[], id: string) => plans.find((plan) => plan.id === id);

/**
 * Transitional fallback until the external catalog is wired in (see the PocketBase proposal
 * sent with ORQ-1-0044). Existing callers still import these; new code must use the Plan helpers above.
 */
export const subscriptionPlans: readonly Plan[] = [
  { id: "initial", name: "Plan Inicial", priceArs: 15_000, credits: 550, featured: false, visibility: "public", period: PLAN_PERIOD },
  { id: "pro", name: "Plan Pro", priceArs: 60_000, credits: 1_650, featured: true, visibility: "public", period: PLAN_PERIOD },
  { id: "agency", name: "Plan Agencia", priceArs: 120_000, credits: 2_450, featured: false, visibility: "public", period: PLAN_PERIOD },
  { id: "test", name: "TEST PLAN", priceArs: 10, credits: 1_000, featured: false, visibility: "private", period: PLAN_PERIOD },
];

export function getSubscriptionPlan(id: string) {
  return findPlan(subscriptionPlans, id);
}
