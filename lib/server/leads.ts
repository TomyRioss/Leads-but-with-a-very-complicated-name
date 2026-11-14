import { pocketBaseFetch } from "@/lib/server/pocketbase";

export const RECORD_ID = /^[a-zA-Z0-9]{15}$/;
export const MAX_DELETE_LEADS = 200;
const DELETE_CONCURRENCY = 5;

export type DeleteLeadsResult = { deleted: number; failed: string[] } | { error: "batch_not_found" };

/**
 * Borra leads de un lote del usuario. Solo borra ids que pertenecen a ese lote; los ajenos se ignoran
 * (aparecen en `failed`, sin revelar si existen). El dedupe de búsquedas vive en el monitor de Apify,
 * no en estos registros, así que borrar no hace reaparecer locales. No reembolsa créditos.
 */
export async function deleteBatchLeads(userId: string, batchId: string, leadIds: string[]): Promise<DeleteLeadsResult> {
  const batch = await pocketBaseFetch<{ items: { id: string; result_count?: number }[] }>(
    `/api/collections/lead_batches/records?perPage=1&skipTotal=1&filter=${encodeURIComponent(`id = "${batchId}" && user = "${userId}"`)}`,
  );
  const owned = batch.items[0];
  if (!owned) return { error: "batch_not_found" };

  // Un solo GET valida pertenencia de todos los ids (ids ya validados por regex, sin inyección).
  const idFilter = leadIds.map((id) => `id = "${id}"`).join(" || ");
  const found = await pocketBaseFetch<{ items: { id: string }[] }>(
    `/api/collections/leads/records?perPage=${MAX_DELETE_LEADS}&skipTotal=1&fields=id&filter=${encodeURIComponent(`batch = "${batchId}" && (${idFilter})`)}`,
  );
  const inBatch = found.items.map((item) => item.id);
  const inBatchSet = new Set(inBatch);
  const failed = leadIds.filter((id) => !inBatchSet.has(id));

  let deleted = 0;
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(DELETE_CONCURRENCY, inBatch.length) }, async () => {
    while (next < inBatch.length) {
      const id = inBatch[next++];
      try {
        await pocketBaseFetch(`/api/collections/leads/records/${id}`, { method: "DELETE" });
        deleted++;
      } catch {
        failed.push(id);
      }
    }
  }));

  if (deleted > 0) {
    // ponytail: read-modify-write; concurrent deletes on same batch could drift result_count, recount via list if it matters
    await pocketBaseFetch(`/api/collections/lead_batches/records/${batchId}`, {
      method: "PATCH",
      body: JSON.stringify({ result_count: Math.max(0, (owned.result_count ?? 0) - deleted) }),
    }).catch((error) => console.error("PocketBase batch count update failed:", error));
  }

  return { deleted, failed };
}
