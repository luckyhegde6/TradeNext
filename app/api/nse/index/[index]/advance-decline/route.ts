import { NextResponse } from "next/server";
import { getAdvanceDecline } from "@/lib/index-service";

export async function GET(req: Request, { params }: { params: Promise<{ index: string }> }) {
    const { index } = await params;
    const indexName = decodeURIComponent(index);

    try {
        const data = await getAdvanceDecline(indexName);
        return NextResponse.json(data);
    } catch (e) {
        console.error("Advance/Decline API Error:", e);
        return NextResponse.json({ error: "Failed to fetch advance/decline data" }, { status: 502 });
    }
}
