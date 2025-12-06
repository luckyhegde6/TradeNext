// app/api/nse/index/[index]/symbols/route.ts
export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { nseFetch, redis } from "@/lib/nse-client";

export async function GET(req: Request, { params }: { params: Promise<{ index: string }> }) {
  const { index } = await params;
  const indexName = decodeURIComponent(index);
  const key = `nse:index:${indexName}:symbols`;
  try {
    const cached = await redis.get(key);
    if (cached) return NextResponse.json(JSON.parse(cached));
    const qs = `?functionName=getAllIndicesSymbols&&index=${encodeURIComponent(indexName)}`;
    const data = await nseFetch("/api/NextApi/apiClient/indexTrackerApi", qs);
    await redis.set(key, JSON.stringify(data), "EX", 300);
    return NextResponse.json(data);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "failed" }, { status: 502 });
  }
}
