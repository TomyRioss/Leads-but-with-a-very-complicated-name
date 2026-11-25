import { json, readJson, withUser } from "@/lib/server/workspace/http";
import { editProposal } from "@/lib/server/workspace/service";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  return withUser(request, "proposal edit", async (user) => {
    const body = await readJson(request);
    if (body === undefined) return json({ error: "invalid_request" }, 400);
    const outcome = await editProposal(user.id, id, body);
    return outcome.ok ? json({ proposal: outcome.value }) : json({ error: outcome.code }, outcome.status);
  });
}
