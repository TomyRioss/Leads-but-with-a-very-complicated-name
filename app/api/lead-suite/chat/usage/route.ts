import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server/auth";
import { getGmailDailyUsage } from "@/lib/server/gmail-daily-usage";
import { getWhatsAppSession } from "@/lib/server/whatsapp";

export async function GET(request: Request) {
  let session: Awaited<ReturnType<typeof getCurrentUser>>;
  try {
    session = await getCurrentUser(request);
  } catch {
    return NextResponse.json({ error: "account_service" }, { status: 503 });
  }
  if (!session) return NextResponse.json({ error: "sign_in_required" }, { status: 401 });

  try {
    const [gmail, whatsappSession] = await Promise.all([
      getGmailDailyUsage(session.user.id),
      getWhatsAppSession(session.user.id).catch(() => null),
    ]);
    const whatsappLimit = Math.min(40, whatsappSession?.dailyLimit ?? 40);
    return NextResponse.json({
      gmail,
      whatsapp: { used: Math.min(whatsappLimit, whatsappSession?.sentToday ?? 0), limit: whatsappLimit },
    });
  } catch {
    return NextResponse.json({ error: "usage_unavailable" }, { status: 503 });
  }
}
