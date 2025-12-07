import { NextResponse } from "next/server";
import { getStockTrends } from "@/lib/stock-service";

export async function GET(req: Request, { params }: { params: Promise<{ symbol: string }> }) {
    const { symbol } = await params;

    try {
        const data = await getStockTrends(symbol);
        return NextResponse.json(data);
    } catch (e) {
        console.error("Stock Trends API Error:", e);
        return NextResponse.json({ error: "Failed to fetch stock trends" }, { status: 502 });
    }
}
