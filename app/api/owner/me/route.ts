import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/server/owner";

export async function GET(request: Request) {
  return (await requireOwner(request)) ?? NextResponse.json({ owner: true });
}
