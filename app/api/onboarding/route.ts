import { resolveLocale } from "@/lib/server/locale";
import { json, readJson, withUser } from "@/lib/server/workspace/http";
import { startOnboarding } from "@/lib/server/workspace/onboarding";

// Dos llamadas de IA con web_search (investigación + competidores).
export const maxDuration = 300;

export async function POST(request: Request) {
  return withUser(request, "onboarding start", async (user) => {
    const body = await readJson(request);
    if (body === undefined) return json({ error: "invalid_request" }, 400);
    const outcome = await startOnboarding(user, body, resolveLocale(request) === "en" ? "en" : "es");
    return outcome.ok ? json({ business: outcome.value }) : json({ error: outcome.code }, outcome.status);
  });
}
