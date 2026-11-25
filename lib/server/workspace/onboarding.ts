import "server-only";
import type { AppUser } from "@/lib/server/auth";
import type { Business } from "@/lib/workspace/types";
import type { ExploreLocale } from "@/lib/server/explore/ai";
import type { Outcome } from "@/lib/server/workspace/service";
import { parseExploreInput } from "@/lib/server/explore/guard";
import { runResearch } from "@/lib/server/explore/research";
import { runCompetitors } from "@/lib/server/explore/competitors";
import { rateLimited } from "@/lib/server/rate-limit";
import { ensureActiveBusiness, setActiveBusiness } from "@/lib/server/workspace/active";
import { canEditStep, furthestStep, isEditableStep, isoToPb, isRecordId, nextStep, onboardingBusinessRecord, parseOnboardingStep } from "@/lib/server/workspace/mapping";
import { createBusiness, getBusiness, updateBusiness } from "@/lib/server/workspace/repository";

// Casos de uso del onboarding de un negocio (contrato en lib/workspace/types.ts).
// Cada investigación son dos llamadas de IA con web_search: tope por usuario en memoria (por instancia).
const START_RATE = { max: 5, windowMs: 60 * 60_000 } as const;

const fail = (status: number, code: string): { ok: false; status: number; code: string } => ({ ok: false, status, code });

/** POST /api/onboarding: investiga el producto (pasos 1-2 de /explorar), crea el negocio en "company" y lo deja activo si no había. */
export async function startOnboarding(user: Pick<AppUser, "id">, rawBody: unknown, locale: ExploreLocale): Promise<Outcome<Business>> {
  const input = parseExploreInput(rawBody);
  if (!input || input.mode === "services") return fail(400, "invalid_request");
  if (rateLimited(`onboarding-start:${user.id}`, START_RATE.max, START_RATE.windowMs)) return fail(429, "rate_limited");

  let record: ReturnType<typeof onboardingBusinessRecord>;
  try {
    const product = await runResearch(input, locale);
    record = onboardingBusinessRecord(user.id, product, await runCompetitors(product, locale));
  } catch (error) {
    console.error("Onboarding research failed", error instanceof Error ? error.message : "unknown");
    return fail(502, "research_failed");
  }
  const business = await createBusiness(user.id, record);
  // Best effort: el negocio ya existe; si falla el activo, el usuario lo elige después.
  await ensureActiveBusiness(user.id, business.id).catch(() => {});
  return { ok: true, value: business };
}

export async function getOnboarding(userId: string, id: string): Promise<Outcome<Business>> {
  const business = isRecordId(id) ? await getBusiness(userId, id) : null;
  return business ? { ok: true, value: business } : fail(404, "not_found");
}

/** PATCH /api/onboarding/<id> {step, data}: guarda el paso y avanza onboardingStep (nunca retrocede). */
export async function patchOnboarding(userId: string, id: string, step: unknown, data: unknown): Promise<Outcome<Business>> {
  if (!isRecordId(id)) return fail(404, "not_found");
  if (!isEditableStep(step)) return fail(400, "invalid_request");
  const now = new Date();
  // Validación pura antes de leer PocketBase: un payload inválido no cuesta consultas.
  const patch = parseOnboardingStep(step, data, now);
  if (!patch) return fail(400, "invalid_request");

  const business = await getBusiness(userId, id);
  if (!business) return fail(404, "not_found");
  const current = business.onboardingStep ?? "company";
  if (!canEditStep(current, step)) return fail(409, "step_locked");

  const done = step === "capacity";
  const updated = await updateBusiness(userId, id, {
    ...patch,
    onboarding_step: furthestStep(current, nextStep(step)),
    ...(done ? { onboarding_completed_at: isoToPb(now.toISOString()) } : {}),
  });
  if (!updated) return fail(404, "not_found");
  if (done) await setActiveBusiness(userId, id);
  return { ok: true, value: updated };
}
