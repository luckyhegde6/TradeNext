import { NextResponse } from "next/server";
import { getStockChart } from "@/lib/stock-service";

export async function GET(req: Request, { params }: { params: Promise<{ symbol: string }> }) {
    const { symbol } = await params;
    const { searchParams } = new URL(req.url);
    const days = searchParams.get("days") || "1D";

    try {
        const data = await getStockChart(symbol, days);
        return NextResponse.json(data);
    } catch (e) {
        console.error("Stock Chart API Error:", e);
        return NextResponse.json({ error: "Failed to fetch stock chart" }, { status: 502 });
    }
}
