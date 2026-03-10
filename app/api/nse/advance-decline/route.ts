// app/api/nse/advance-decline/route.ts
import { NextResponse } from "next/server";
import { nseFetch } from "@/lib/nse-client";
import logger from "@/lib/logger";

interface StockData {
  symbol: string;
  lastPrice: number;
  pchange: number;
  change: number;
  previousClose: number;
  identifier: "Advances" | "Declines" | "Unchanged";
}

interface NSEEndpointResponse {
  advance?: {
    count: { Advances: number; Declines: number; Unchanged: number; Total: number };
    data: any[];
  };
  decline?: {
    count: { Advances: number; Declines: number; Unchanged: number; Total: number };
    data: any[];
  };
  unchanged?: {
    count: { Advances: number; Declines: number; Unchanged: number; Total: number };
    data: any[];
  };
}

async function fetchCategoryData(
  endpoint: string,
  responseKey: "advance" | "decline" | "unchanged",
  identifier: "Advances" | "Declines" | "Unchanged"
): Promise<{ data: StockData[]; count: number }> {
  try {
    const raw = await nseFetch(endpoint);
    const parsed = raw as NSEEndpointResponse;
    const categoryData = parsed?.[responseKey];

    if (!categoryData || !Array.isArray(categoryData.data)) {
      throw new Error(`Invalid response from ${endpoint}: missing ${responseKey}.data`);
    }

    const stocks: StockData[] = categoryData.data
      .filter((item: any) => item.symbol && item.pchange !== undefined)
      .map((item: any) => ({
        symbol: item.symbol,
        lastPrice: Number(item.lastPrice || 0),
        pchange: Number(item.pchange || 0),
        change: Number(item.change || 0),
        previousClose: Number(item.previousClose || 0),
        identifier,
      }));

    const count = categoryData.count?.[identifier] || stocks.length;

    logger.info({ msg: `Fetched ${identifier} from ${endpoint}`, count: stocks.length });
    return { data: stocks, count };
  } catch (err) {
    logger.error({ msg: `Failed to fetch ${identifier} from ${endpoint}`, error: err });
    return { data: [], count: 0 };
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const page = parseInt(url.searchParams.get("page") || "1", 10);
    const limit = parseInt(url.searchParams.get("limit") || "100", 10);
    const filter = url.searchParams.get("filter"); // "Advances", "Declines", "Unchanged"
    const sortBy = url.searchParams.get("sortBy") || "symbol";
    const sortOrder = url.searchParams.get("sortOrder") || "asc";

    // Fetch all three categories in parallel
    const [advancesRes, declinesRes, unchangedRes] = await Promise.all([
      fetchCategoryData("/api/live-analysis-advance", "advance", "Advances"),
      fetchCategoryData("/api/live-analysis-decline", "decline", "Declines"),
      fetchCategoryData("/api/live-analysis-unchanged", "Unchange", "Unchanged"),
    ]);

    // Combine all data
    const fullStocks: StockData[] = [
      ...advancesRes.data,
      ...declinesRes.data,
      ...unchangedRes.data,
    ];

    // Build summary from counts returned by each endpoint
    const summary = {
      Advances: advancesRes.count,
      Declines: declinesRes.count,
      Unchanged: unchangedRes.count,
      Total: advancesRes.count + declinesRes.count + unchangedRes.count,
    };

    logger.info({ msg: "Combined advance-decline data", totalStocks: fullStocks.length, summary });

    // Apply filter
    let filteredStocks = fullStocks;
    if (filter && ["Advances", "Declines", "Unchanged"].includes(filter)) {
      filteredStocks = fullStocks.filter((item) => item.identifier === filter);
    }

    // Apply sorting
    filteredStocks.sort((a, b) => {
      let aVal: number | string = a[sortBy as keyof StockData];
      let bVal: number | string = b[sortBy as keyof StockData];
      if (typeof aVal === "string") {
        return sortOrder === "asc"
          ? aVal.localeCompare(bVal as string)
          : (bVal as string).localeCompare(aVal);
      }
      return sortOrder === "asc" ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
    });

    // Pagination
    const total = filteredStocks.length;
    const totalPages = Math.ceil(total / limit);
    const offset = (page - 1) * limit;
    const paginatedData = filteredStocks.slice(offset, offset + limit);

    return NextResponse.json({
      data: paginatedData,
      summary,
      total,
      page,
      totalPages,
      limit,
      meta: { fetchedAt: new Date().toISOString() },
    });
  } catch (e) {
    logger.error({ msg: "Failed to fetch advance-decline", error: e });
    return NextResponse.json(
      {
        data: [],
        summary: { Advances: 0, Declines: 0, Unchanged: 0, Total: 0 },
        total: 0,
        page: 1,
        totalPages: 0,
        error: "Failed to fetch data",
      },
      { status: 500 }
    );
  }
}
