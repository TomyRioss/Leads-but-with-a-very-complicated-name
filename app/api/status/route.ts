import { connection, NextResponse } from "next/server";
import { isPocketBaseConfigured } from "@/lib/server/pocketbase";

export async function GET() {
  await connection();
  return NextResponse.json({
    apifyConfigured: Boolean(process.env.APIFY_TOKEN),
    pocketBaseConfigured: isPocketBaseConfigured(),
    environment: process.env.ENVIROMENT?.trim().toLowerCase() === "dev" ? "dev" : "prod",
  });
}
