import cache from "@/lib/cache";
import { nseFetch } from "@/lib/nse-client";

/**
 * Get stock quote data from NSE
 * API: /api/NextApi/apiClient/GetQuoteApi?functionName=getSymbolData&marketType=N&series=EQ&symbol=SBIN
 */
export async function getStockQuote(symbol: string) {
    const cacheKey = `nse:stock:${symbol}:quote`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

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

        const quote = {
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
        cache.set(cacheKey, quote, 120); // 2 mins
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
export async function getStockChart(symbol: string, days: string = "1D") {
    const cacheKey = `nse:stock:${symbol}:chart:${days}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

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
export async function getStockTrends(symbol: string) {
    const cacheKey = `nse:stock:${symbol}:trends`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

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
