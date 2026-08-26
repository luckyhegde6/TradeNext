import { NextResponse } from "next/server";
import { getStockChart } from "@/lib/stock-service";
import logger from "@/lib/logger";

export async function GET(req: Request, { params }: { params: Promise<{ symbol: string }> }) {
    const { symbol } = await params;
    const { searchParams } = new URL(req.url);
    const days = searchParams.get("days") || "1D";

    try {
        const data = await getStockChart(symbol, days);
        return NextResponse.json(data);
    } catch (e) {
        logger.warn({ msg: "Stock Chart: fetch failed", symbol, error: e instanceof Error ? e.message : String(e) });
        return NextResponse.json(null);
    }
}
