import { NextResponse } from "next/server";
import { getStockQuote } from "@/lib/stock-service";
import logger from "@/lib/logger";

export async function GET(req: Request, { params }: { params: Promise<{ symbol: string }> }) {
    const { symbol } = await params;

    try {
        const data = await getStockQuote(symbol);
        return NextResponse.json(data);
    } catch (e) {
        logger.warn({ msg: "Stock Quote: fetch failed", symbol, error: e instanceof Error ? e.message : String(e) });
        return NextResponse.json(null);
    }
}
