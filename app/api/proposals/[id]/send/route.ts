import { json, withUser } from "@/lib/server/workspace/http";
import { sendProposal } from "@/lib/server/workspace/service";

export const maxDuration = 60;
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  return withUser(request, "proposal send", async (user) => {
    const outcome = await sendProposal(user.id, id);
    return outcome.ok ? json({ proposal: outcome.value }) : json({ error: outcome.code }, outcome.status);
  });
}
