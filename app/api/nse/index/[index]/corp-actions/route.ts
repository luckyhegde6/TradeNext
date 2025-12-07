import { NextResponse } from "next/server";
import { getIndexCorporateActions } from "@/lib/index-service";

export async function GET(req: Request, { params }: { params: Promise<{ index: string }> }) {
    const { index } = await params;
    const indexName = decodeURIComponent(index);

    try {
        const data = await getIndexCorporateActions(indexName);
        return NextResponse.json(data);
    } catch (e) {
        console.error("Corp Actions API Error:", e);
        return NextResponse.json({ error: "Failed to fetch corp actions" }, { status: 502 });
    }
}
