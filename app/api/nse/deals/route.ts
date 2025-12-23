// app/api/nse/deals/route.ts
import { NextResponse } from "next/server";
import { nseFetch } from "@/lib/nse-client";
import { normalizeDeals } from "@/lib/nse/normalize";

export async function GET() {
  const data = await nseFetch("/api/snapshot-capital-market-largedeal");
  const normalized = normalizeDeals(data);
  return NextResponse.json(
    { data: normalized },
    { headers: { "Cache-Control": "no-store" } }
  );
}
