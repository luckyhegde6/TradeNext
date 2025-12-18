import cache, { hotCache } from "@/lib/cache";
import { nseFetch } from "@/lib/nse-client";

// Type definitions
interface StockQuote {
    symbol: string;
    companyName: string;
    identifier: string;
    isinCode: string;
    series: string;
    lastPrice: number;
    open: number;
    dayHigh: number;
    dayLow: number;
    previousClose: number;
    change: number;
    pChange: number;
    totalTradedVolume: number;
    totalTradedValue: number;
    yearHigh: number;
    yearLow: number;
    peRatio: number;
    marketCap: number;
    industry: string;
    sector: string;
    indexList: string[];
}

/**
 * Get stock quote data from NSE
 * API: /api/NextApi/apiClient/GetQuoteApi?functionName=getSymbolData&marketType=N&series=EQ&symbol=SBIN
 */
export async function getStockQuote(symbol: string): Promise<StockQuote> {
    const cacheKey = `nse:stock:${symbol}:quote`;
    const cached = hotCache.get(cacheKey); // Use hot cache for frequently accessed stock quotes
    if (cached) return cached as StockQuote;

    const qs = `?functionName=getSymbolData&marketType=N&series=EQ&symbol=${encodeURIComponent(symbol)}`;
    try {
        console.log(`[Stock Service] Fetching quote for ${symbol}`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rawData = await nseFetch("/api/NextApi/apiClient/GetQuoteApi", qs) as any;
        console.log(`[Stock Service] Raw response:`, JSON.stringify(rawData).substring(0, 200));

        const data = rawData?.equityResponse?.[0] || rawData;

        // Extract data from nested structure
        const metaData = data.metaData || {};
        const tradeInfo = data.tradeInfo || {};
        const priceInfo = data.priceInfo || {};
        const secInfo = data.secInfo || {};

        const quote: StockQuote = {
            symbol: metaData.symbol || symbol,
            companyName: metaData.companyName || '',
            identifier: metaData.identifier || '',
            isinCode: metaData.isinCode || '',
            series: metaData.series || 'EQ',

            // Price data from metaData
            lastPrice: parseFloat(metaData.lastPrice || tradeInfo.lastPrice || 0),
            open: parseFloat(metaData.open || 0),
            dayHigh: parseFloat(metaData.dayHigh || 0),
            dayLow: parseFloat(metaData.dayLow || 0),
            previousClose: parseFloat(metaData.previousClose || 0),
            change: parseFloat(metaData.change || 0),
            pChange: parseFloat(metaData.pChange || 0),

            // Trading data from tradeInfo
            totalTradedVolume: parseInt(tradeInfo.totalTradedVolume || 0),
            totalTradedValue: parseFloat(tradeInfo.totalTradedValue || 0),

            // 52-week data from priceInfo
            yearHigh: parseFloat(priceInfo.yearHigh || 0),
            yearLow: parseFloat(priceInfo.yearLow || 0),

            // Valuation from secInfo
            peRatio: parseFloat(secInfo.pdSymbolPe || 0),
            marketCap: parseFloat(tradeInfo.totalMarketCap || 0),

            // Additional info from secInfo
            industry: secInfo.basicIndustry || '',
            sector: secInfo.pdSectorInd?.trim() || '',
            indexList: secInfo.indexList || [],
        };

        console.log(`[Stock Service] Mapped quote:`, quote);
        hotCache.set(cacheKey, quote, 120); // Cache in hot cache for 2 mins
        return quote;
    } catch (e) {
        console.error(`[Stock Service] Error fetching quote for ${symbol}:`, e);
        throw e;
    }
}

/**
 * Get stock chart data from NSE
 * API: /api/NextApi/apiClient/GetQuoteApi?functionName=getSymbolChartData&symbol=SBINEQN&days=1D
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getStockChart(symbol: string, days: string = "1D"): Promise<any[]> {
    const cacheKey = `nse:stock:${symbol}:chart:${days}`;
    const cached = cache.get(cacheKey);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (cached) return cached as any[];

    // Need to get identifier first (e.g., SBINEQN for SBIN)
    const quote = await getStockQuote(symbol);
    const identifier = quote.identifier || `${symbol}EQN`;

    const qs = `?functionName=getSymbolChartData&symbol=${encodeURIComponent(identifier)}&days=${days}`;
    try {
        console.log(`[Stock Service] Fetching chart for ${identifier}, days: ${days}`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rawData = await nseFetch("/api/NextApi/apiClient/GetQuoteApi", qs) as any;
        const chartData = rawData?.grapthData || rawData?.graphData || [];

        console.log(`[Stock Service] Chart data points: ${chartData.length}`);
        cache.set(cacheKey, chartData, 300); // 5 mins
        return chartData;
    } catch (e) {
        console.error(`[Stock Service] Error fetching chart for ${symbol}:`, e);
        return [];
    }
}

/**
 * Get stock yearwise trend data from NSE
 * API: /api/NextApi/apiClient/GetQuoteApi?functionName=getYearwiseData&symbol=SBINEQN
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getStockTrends(symbol: string): Promise<any[]> {
    const cacheKey = `nse:stock:${symbol}:trends`;
    const cached = cache.get(cacheKey);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (cached) return cached as any[];

    // Need to get identifier first
    const quote = await getStockQuote(symbol);
    const identifier = quote.identifier || `${symbol}EQN`;

    const qs = `?functionName=getYearwiseData&symbol=${encodeURIComponent(identifier)}`;
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rawData = await nseFetch("/api/NextApi/apiClient/GetQuoteApi", qs) as any;
        const trends = rawData?.data || [];

        cache.set(cacheKey, trends, 3600); // 1 hour
        return trends;
    } catch (e) {
        console.error(`[Stock Service] Error fetching trends for ${symbol}:`, e);
        return [];
    }
}
