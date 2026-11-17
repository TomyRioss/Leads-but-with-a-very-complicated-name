// Connected MCP apps of the signed-in user (settings UI): list and revoke.
import { NextResponse } from "next/server";
import { getCurrentUser, withRefreshedSession } from "@/lib/server/auth";
import { sameOrigin } from "@/lib/server/leadtita-conversations";
import { listUserGrants, readJsonObject, revokeUserGrant } from "@/lib/server/mcp/oauth";

const json = (body: object, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request) {
  try {
    const session = await getCurrentUser(request);
    if (!session) return json({ error: "unauthorized" }, 401);
    return withRefreshedSession(json({ items: await listUserGrants(session.user.id) }), session.token);
  } catch {
    return json({ error: "unavailable" }, 503);
  }
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return json({ error: "unsupported_media_type" }, 415);
  try {
    const session = await getCurrentUser(request);
    if (!session) return json({ error: "unauthorized" }, 401);
    const body = await readJsonObject(request);
    if (typeof body?.id !== "string") return withRefreshedSession(json({ error: "invalid_request" }, 400), session.token);
    const revoked = await revokeUserGrant(session.user.id, body.id);
    return withRefreshedSession(revoked ? json({ ok: true }) : json({ error: "not_found" }, 404), session.token);
  } catch {
    return json({ error: "unavailable" }, 503);
  }
}
