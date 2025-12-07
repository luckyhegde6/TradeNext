import { NextResponse } from "next/server";
import { getStockQuote } from "@/lib/stock-service";

export async function GET(req: Request, { params }: { params: Promise<{ symbol: string }> }) {
    const { symbol } = await params;

    try {
        const data = await getStockQuote(symbol);
        return NextResponse.json(data);
    } catch (e) {
        console.error("Stock Quote API Error:", e);
        return NextResponse.json({ error: "Failed to fetch stock quote" }, { status: 502 });
    }
}
