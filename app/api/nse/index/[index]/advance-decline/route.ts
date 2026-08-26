import { NextResponse } from "next/server";
import { getAdvanceDecline } from "@/lib/index-service";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ index: string }> }) {
    const { index } = await params;
    const indexName = decodeURIComponent(index);

    try {
        const data = await getAdvanceDecline(indexName);
        return NextResponse.json(data);
    } catch (e) {
        return NextResponse.json({ advances: [], declines: [], unchanged: [] });
    }
}
