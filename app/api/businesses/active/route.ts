import { json, readJson, withUser } from "@/lib/server/workspace/http";
import { setActiveBusiness } from "@/lib/server/workspace/active";
import { isRecordId } from "@/lib/server/workspace/mapping";

export async function PATCH(request: Request) {
  return withUser(request, "business activate", async (user) => {
    const body = await readJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "invalid_request" }, 400);
    const { businessId } = body as { businessId?: unknown };
    // Un id malformado no puede ser un negocio del usuario.
    if (!isRecordId(businessId) || !(await setActiveBusiness(user.id, businessId))) return json({ error: "not_found" }, 404);
    return json({ activeId: businessId });
  });
}
