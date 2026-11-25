// Plans are data managed by an external billing system. Nothing here defines the catalog:
// callers pass in the plans they loaded (public ones plus any exclusive to a user).
// All externally agreed plans are monthly: price and credits renew every month, no annual option.

export const PLAN_PERIOD = "month" as const;

export type PlanVisibility = "public" | "private";

/** Monthly caps, month in Buenos Aires time. scheduledMonthly counts WhatsApp messages scheduled this month. */
export type PlanLimits = { whatsappMonthly: number; emailMonthly: number; scheduledMonthly: number };

export type Plan = {
  id: string;
  name: string;
  priceUsd: number;
  /** Monthly price in ARS. Argentina pricing shows this; other markets show priceUsd. */
  priceArs: number;
  /** Credits granted on each monthly renewal. */
  credits: number;
  limits: PlanLimits;
  featured?: boolean;
  /** "private" plans never show on the public pricing page. */
  visibility: PlanVisibility;
  /** Plan that only grants credits: pricing lists the credits line and nothing else. */
  creditsOnly?: boolean;
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
const growthLimits: PlanLimits = { whatsappMonthly: 750, emailMonthly: 750, scheduledMonthly: 100 };

export const subscriptionPlans: readonly Plan[] = [
  { id: "starter", name: "Starter", priceUsd: 15, priceArs: 25_000, credits: 350, limits: { whatsappMonthly: 150, emailMonthly: 150, scheduledMonthly: 20 }, featured: false, visibility: "public", period: PLAN_PERIOD },
  { id: "growth", name: "Growth", priceUsd: 50, priceArs: 75_000, credits: 1_750, limits: growthLimits, featured: true, visibility: "public", period: PLAN_PERIOD },
  // ponytail: temporary public plan to test real Mercado Pago payments in production (MP minimum is ARS 15). Remove after the test.
  { id: "prueba", name: "Prueba", priceUsd: 0.01, priceArs: 15, credits: 100, limits: { whatsappMonthly: 0, emailMonthly: 0, scheduledMonthly: 0 }, creditsOnly: true, featured: false, visibility: "public", period: PLAN_PERIOD },
];

/** Accounts without an active plan (unchanged pre-plan behavior): 10 schedules count every channel; no monthly email cap. */
export const FREE_LIMITS: PlanLimits = { whatsappMonthly: 100, emailMonthly: Infinity, scheduledMonthly: 10 };
/** ponytail: an active subscription whose plan isn't in this catalog (legacy or Custom) gets Growth caps. Add Custom caps to the catalog when one is agreed. */
export const UNKNOWN_PLAN_LIMITS = growthLimits;
/** Custom plan: agreed directly over WhatsApp. */
export const CUSTOM_PLAN_WHATSAPP = "541171410652";

export function getSubscriptionPlan(id: string) {
  return findPlan(subscriptionPlans, id);
}
