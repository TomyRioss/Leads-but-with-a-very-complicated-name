export const subscriptionPlans = [
  { id: "initial", name: "Plan Inicial", priceArs: 15_000, credits: 550, featured: false },
  { id: "pro", name: "Plan Pro", priceArs: 60_000, credits: 1_650, featured: true },
  { id: "agency", name: "Plan Agencia", priceArs: 120_000, credits: 2_450, featured: false },
  { id: "test", name: "TEST PLAN", priceArs: 10, credits: 1_000, featured: false },
] as const;

export type SubscriptionPlanId = (typeof subscriptionPlans)[number]["id"];

export function getSubscriptionPlan(id: string) {
  return subscriptionPlans.find((plan) => plan.id === id);
}
