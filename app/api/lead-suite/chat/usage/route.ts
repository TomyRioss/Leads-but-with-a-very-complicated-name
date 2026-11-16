import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server/auth";
import { checkAiDailyLimit } from "@/lib/server/ai-daily-limit";
import { getGmailDailyUsage } from "@/lib/server/gmail-daily-usage";
import { whatsAppMonthlyUsage } from "@/lib/server/scheduled-messages";

export async function GET(request: Request) {
  let session: Awaited<ReturnType<typeof getCurrentUser>>;
  try {
    session = await getCurrentUser(request);
  } catch {
    return NextResponse.json({ error: "account_service" }, { status: 503 });
  }
  if (!session) return NextResponse.json({ error: "sign_in_required" }, { status: 401 });

  try {
    const [gmail, whatsapp, ai] = await Promise.all([
      getGmailDailyUsage(session.user.id),
      whatsAppMonthlyUsage(session.user.id),
      checkAiDailyLimit(session.user),
    ]);
    return NextResponse.json({
      gmail,
      // Monthly (plan cap): sent + queued + scheduled.
      whatsapp: { used: whatsapp.used, limit: whatsapp.limit },
      // null = no daily AI cap (owner or active plan).
      ai: ai.unlimited ? null : { used: Math.min(ai.limit, ai.used), limit: ai.limit },
    });
  } catch {
    return NextResponse.json({ error: "usage_unavailable" }, { status: 503 });
  }
}
