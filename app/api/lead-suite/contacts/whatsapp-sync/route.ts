import { NextResponse } from "next/server";
import { syncWhatsAppContacts } from "@/lib/server/whatsapp-contact-sync";
import { requireUser, serverError } from "../validate";

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  let body: { items?: unknown } | null;
  try {
    const raw = await request.text();
    if (raw.length > 50_000) return NextResponse.json({ error: "invalid_items" }, { status: 413 });
    body = JSON.parse(raw) as { items?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid_items" }, { status: 400 });
  }
  try {
    const result = await syncWhatsAppContacts(auth.userId, body?.items);
    return NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return serverError(request, "WhatsApp contact sync", error);
  }
}
