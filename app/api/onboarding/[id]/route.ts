import { connection } from "next/server";
import { json, readJson, withUser } from "@/lib/server/workspace/http";
import { getOnboarding, patchOnboarding } from "@/lib/server/workspace/onboarding";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  await connection();
  const { id } = await context.params;
  return withUser(request, "onboarding get", async (user) => {
    const outcome = await getOnboarding(user.id, id);
    return outcome.ok ? json({ business: outcome.value }) : json({ error: outcome.code }, outcome.status);
  });
}

export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  return withUser(request, "onboarding step", async (user) => {
    const body = await readJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "invalid_request" }, 400);
    const { step, data } = body as { step?: unknown; data?: unknown };
    const outcome = await patchOnboarding(user.id, id, step, data);
    return outcome.ok ? json({ business: outcome.value }) : json({ error: outcome.code }, outcome.status);
  });
}
