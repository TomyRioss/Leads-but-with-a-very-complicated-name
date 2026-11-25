import "server-only";
import type { Business } from "@/lib/workspace/types";
import { pocketBaseFetch } from "@/lib/server/pocketbase";
import { createBusiness, getBusiness, listBusinesses } from "@/lib/server/workspace/repository";
import { isRecordId } from "@/lib/server/workspace/mapping";
import { getCommercialProfile } from "@/lib/server/user-profile";
import { profileFromBusiness } from "@/lib/workspace/business-prompt";

// Negocio activo del usuario (users.active_business). Nunca confía en el id guardado sin verificar que el negocio siga siendo del usuario.
const userPath = (userId: string) => `/api/collections/users/records/${encodeURIComponent(userId)}?fields=active_business`;

async function readActiveId(userId: string): Promise<string> {
  const record = await pocketBaseFetch<{ active_business?: unknown }>(userPath(userId));
  return isRecordId(record.active_business) ? record.active_business : "";
}

/** Negocio activo verificado: una lectura de users y un chequeo de propiedad. */
export async function getActiveBusiness(userId: string): Promise<Business | null> {
  const id = await readActiveId(userId);
  return id ? getBusiness(userId, id) : null;
}

/** Id del negocio activo; "" si no hay, si se borró o si no es del usuario. */
export async function getActiveBusinessId(userId: string): Promise<string> {
  return (await getActiveBusiness(userId))?.id ?? "";
}

/** Marca el negocio como activo; false si no es del usuario. */
export async function setActiveBusiness(userId: string, businessId: string): Promise<boolean> {
  if (!(await getBusiness(userId, businessId))) return false;
  await pocketBaseFetch(userPath(userId), { method: "PATCH", body: JSON.stringify({ active_business: businessId }) });
  return true;
}

/** Deja el negocio como activo solo si el usuario todavía no tiene uno válido. */
export async function ensureActiveBusiness(userId: string, businessId: string): Promise<void> {
  if (await getActiveBusinessId(userId)) return;
  await setActiveBusiness(userId, businessId);
}

/** Servicio que vende el usuario para enfocar análisis: el del negocio activo, o el perfil comercial guardado. "" si falla. */
export async function activeServiceOffering(userId: string): Promise<string> {
  const [business, saved] = await Promise.all([getActiveBusiness(userId).catch(() => null), getCommercialProfile(userId).catch(() => ({ serviceOffering: "", commercialSectors: "" }))]);
  return (business ? profileFromBusiness(business, saved) : saved).serviceOffering;
}

const NAME_MAX = 40;
// ponytail: dedupe en memoria por instancia; dos instancias a la vez podrían crear dos negocios (raro: una sola vez por cuenta).
const migrating = new Map<string, Promise<Business[]>>();

/** Nombre corto desde el servicio: hasta la primera coma o punto, cortado en palabra a NAME_MAX. */
export function nameFromOffering(offering: string) {
  const first = offering.split(/[.,;\n]/)[0].trim().replace(/\s+/g, " ");
  if (first.length <= NAME_MAX) return first;
  const cut = first.slice(0, NAME_MAX + 1);
  return cut.slice(0, cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : NAME_MAX).trim();
}

/**
 * Negocios del usuario. Cuentas viejas sin negocios pero con perfil comercial: una sola vez se crea el negocio
 * desde ese perfil y queda activo, así el selector muestra el negocio con el que ya trabajan.
 */
export async function listBusinessesWithProfile(userId: string): Promise<Business[]> {
  const businesses = await listBusinesses(userId);
  if (businesses.length) return businesses;
  const pending = migrating.get(userId);
  if (pending) return pending;
  const task = (async () => {
    const { serviceOffering } = await getCommercialProfile(userId);
    const name = nameFromOffering(serviceOffering);
    if (!name) return [];
    const business = await createBusiness(userId, { name, summary: serviceOffering });
    await ensureActiveBusiness(userId, business.id).catch(() => {});
    return [business];
  })().finally(() => migrating.delete(userId));
  migrating.set(userId, task);
  return task;
}

/** Negocio activo con onboarding sin terminar (p. ej. recién traspasado de /explorar); "" si no hay. A dónde mandar al usuario al entrar. */
export async function pendingOnboardingBusinessId(userId: string): Promise<string> {
  const business = await getActiveBusiness(userId).catch(() => null);
  return business && business.onboardingStep !== "done" ? business.id : "";
}
