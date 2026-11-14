import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runWeeklyReports } from "@/lib/server/lead-suite-report";

export const maxDuration = 300;

// Margen para terminar el lote en curso (modelo 25 s + email 10 s) antes del límite de 300 s.
const budgetMs = 240_000;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const started = Date.now();
  try {
    const result = await runWeeklyReports(new Date(started), started + budgetMs);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[lead-suite-weekly-report]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Weekly report run failed" }, { status: 500 });
  }
}
