import { NextResponse } from "next/server";
import { getOwnerSession } from "@/lib/server/owner";
import { errorTranslator } from "@/lib/server/locale";
import { rateLimited } from "@/lib/server/rate-limit";
import { autoRunAllowed, verifyOwnerChange } from "@/lib/server/owner-assistant-policy";
import { applyOwnerChange, normalizeOwnerChange } from "@/lib/server/owner-assistant-tools";
import { errorResponse, pocketBaseNotReady } from "../../_shared";

const MAX_BODY_BYTES = 200_000;
const CONFIRM_RATE = { max: 30, windowMs: 60_000 } as const;

/**
 * Executes a Leadtita Staff change. Owner only (checked before reading the body). The signed token is the only input:
 * it is verified (owner, expiry, purpose), its arguments re-validated, and automatic runs re-checked against the
 * permission rule. Execution and audit go through the same functions as the owner routes.
 */
export async function POST(request: Request) {
  const session = await getOwnerSession(request);
  if ("response" in session) return session.response;
  const t = errorTranslator(request);
  const denied = pocketBaseNotReady(request);
  if (denied) return denied;
  if (rateLimited(`owner-assistant-confirm:${session.owner.id}`, CONFIRM_RATE.max, CONFIRM_RATE.windowMs)) {
    return NextResponse.json({ error: t("aiRateLimited"), code: "rate" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  let token: unknown;
  let auto: unknown;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return errorResponse(t("invalidRequestBody"), 413);
    const body = JSON.parse(raw) as { token?: unknown; auto?: unknown };
    token = body?.token;
    auto = body?.auto;
  } catch {
    return errorResponse(t("invalidRequestBody"), 400);
  }

  const verified = verifyOwnerChange(token, session.owner.id);
  const args = verified ? normalizeOwnerChange(verified.kind, verified.args) : null;
  if (!verified || !args) return NextResponse.json({ error: t("invalidRequestBody"), code: "invalid" }, { status: 400 });
  // "skip" can't unlock carded kinds, and no automatic run can exceed the mode the card was proposed under.
  if (!autoRunAllowed(auto, verified.perm, verified.kind, args)) {
    return NextResponse.json({ error: t("generic"), code: "needs_confirmation" }, { status: 409 });
  }

  const result = await applyOwnerChange(request, session.owner, verified.kind, args);
  if (!result.ok) return NextResponse.json({ error: t(result.error), ...(result.code ? { code: result.code } : {}) }, { status: result.status });
  return NextResponse.json({ result: { kind: verified.kind, summary: result.value } });
}
