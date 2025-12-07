// app/api/nse/index/[index]/route.ts
export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { getIndexDetails } from "@/lib/index-service";

export async function GET(req: Request, { params }: { params: Promise<{ index: string }> }) {
    const { index } = await params;
    const indexName = decodeURIComponent(index);

    try {
        const data = await getIndexDetails(indexName);
        return NextResponse.json(data);
    } catch (e) {
        console.error(`Error fetching details for ${indexName}:`, e);
        return NextResponse.json({ error: "failed to fetch details" }, { status: 502 });
    }
}
