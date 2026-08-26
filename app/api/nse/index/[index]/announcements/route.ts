import { NextResponse } from "next/server";
import { getIndexAnnouncements } from "@/lib/index-service";

export async function GET(req: Request, { params }: { params: Promise<{ index: string }> }) {
    const { index } = await params;
    const indexName = decodeURIComponent(index);

    try {
        const data = await getIndexAnnouncements(indexName);
        return NextResponse.json(data);
    } catch (e) {
        return NextResponse.json([]);
    }
}
