// app/api/nse/advance-decline/route.ts
import { NextResponse } from "next/server";
import { nseFetch } from "@/lib/nse-client";

export async function GET() {
  const data = await nseFetch("/api/live-analysis-advance");
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
