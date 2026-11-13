import { NextResponse } from "next/server";
import { REFERRAL_COOKIE, REFERRAL_COOKIE_MAX_AGE, isValidReferralCode } from "@/lib/server/referrals";

/** Remembers ?ref=<code> in an httpOnly cookie until the visitor signs up (email or Google). */
export async function POST(request: Request) {
  let code: unknown;
  try {
    ({ code } = (await request.json()) as { code?: unknown });
  } catch {
    code = undefined;
  }
  if (!isValidReferralCode(code)) return NextResponse.json({ ok: false }, { status: 400 });
  const response = NextResponse.json({ ok: true });
  response.cookies.set(REFERRAL_COOKIE, code, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: REFERRAL_COOKIE_MAX_AGE,
  });
  return response;
}
