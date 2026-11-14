import { connection, NextResponse } from "next/server";
import { enabledDevFeatures, isDevEnvironment } from "@/lib/env-features";
import { isPocketBaseConfigured } from "@/lib/server/pocketbase";

export async function GET() {
  await connection();
  const dev = isDevEnvironment();
  return NextResponse.json({
    apifyConfigured: Boolean(process.env.APIFY_TOKEN),
    pocketBaseConfigured: isPocketBaseConfigured(),
    environment: dev ? "dev" : "prod",
    devFeatures: enabledDevFeatures(),
    devOnly: dev,
  });
}
