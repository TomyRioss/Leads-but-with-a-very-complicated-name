import "server-only";
import type { Business } from "@/lib/workspace/types";
import { pocketBaseFetch } from "@/lib/server/pocketbase";
import { getBusiness } from "@/lib/server/workspace/repository";
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
