import { NextResponse } from "next/server";
import { getStockQuote } from "@/lib/stock-service";
import logger from "@/lib/logger";

export const runtime = "nodejs";

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const symbolsParam = searchParams.get("symbols");

        if (!symbolsParam) {
            return NextResponse.json({ error: "Missing symbols parameter" }, { status: 400 });
        }

        const symbols = symbolsParam.split(",").filter(Boolean);
        const quotes = await Promise.all(
            symbols.map(async (symbol) => {
                try {
                    const quote = await getStockQuote(symbol);
                    return {
                        symbol: quote.symbol,
                        lastPrice: quote.lastPrice,
                        change: quote.change,
                        pChange: quote.pChange,
                        volume: quote.totalTradedVolume,
                        open: quote.open,
                        high: quote.dayHigh,
                        low: quote.dayLow,
                        close: quote.closePrice,
                    };
                } catch (err) {
                    logger.error({ msg: "Failed to fetch quote for symbol", symbol, error: err });
                    return { symbol, error: "Not found" };
                }
            })
        );

        return NextResponse.json(quotes);
    } catch (error) {
        logger.error({ msg: "Quote API error", error });
        return NextResponse.json({ error: "Failed to fetch quotes" }, { status: 500 });
    }
}
