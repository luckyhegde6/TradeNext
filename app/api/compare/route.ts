import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const symbolsParam = searchParams.get("symbols");
    
    if (!symbolsParam) {
      return NextResponse.json({ error: "Symbols parameter is required" }, { status: 400 });
    }

    const symbols = symbolsParam.split(",").map(s => s.trim().toUpperCase()).filter(s => s);
    
    if (symbols.length === 0) {
      return NextResponse.json({ error: "At least one symbol is required" }, { status: 400 });
    }

    if (symbols.length > 5) {
      return NextResponse.json({ error: "Maximum 5 symbols can be compared at once" }, { status: 400 });
    }

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

    const results = await Promise.all(
      symbols.map(async (symbol) => {
        try {
          const response = await fetch(`${baseUrl}/api/nse/stock/${encodeURIComponent(symbol)}/quote`);
          
          if (!response.ok) {
            return null;
          }
          
          const data = await response.json();
          
          if (!data || data.error) {
            return null;
          }

          return {
            symbol: data.symbol || symbol,
            lastPrice: parseFloat(data.lastPrice || "0"),
            change: parseFloat(data.change || "0"),
            pChange: parseFloat(data.pChange || "0"),
            open: parseFloat(data.open || "0"),
            high: parseFloat(data.dayHigh || "0"),
            low: parseFloat(data.dayLow || "0"),
            close: parseFloat(data.closePrice || "0"),
            volume: 0,
            avgVolume: 0,
            marketCap: 0,
            pe: 0,
            pb: 0,
            dividendYield: 0,
            week52High: parseFloat(data.yearHigh || "0"),
            week52Low: parseFloat(data.yearLow || "0"),
          };
        } catch (error) {
          console.error(`Error fetching quote for ${symbol}:`, error);
          return null;
        }
      })
    );

    const validResults = results.filter(r => r !== null);
    
    if (validResults.length === 0) {
      return NextResponse.json({ error: "No valid stock data found" }, { status: 404 });
    }

    return NextResponse.json(validResults);
  } catch (error) {
    console.error("Compare API error:", error);
    return NextResponse.json({ error: "Failed to fetch stock data" }, { status: 500 });
  }
}
