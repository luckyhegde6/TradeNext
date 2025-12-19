import cache from "@/lib/cache";
import { nseFetch } from "@/lib/nse-client";
import { enhancedCache, nseCache, marketDataPoller } from "@/lib/enhanced-cache";
import logger from "@/lib/logger";

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
export async function getStockQuote(symbol: string, enablePolling: boolean = false): Promise<StockQuote> {
    const cacheConfig = nseCache.stockQuote(symbol);

    const fetchQuote = async (): Promise<StockQuote> => {
        const qs = `?functionName=getSymbolData&marketType=N&series=EQ&symbol=${encodeURIComponent(symbol)}`;

        logger.info({ msg: 'Fetching stock quote from NSE', symbol });

        const rawData = await nseFetch("/api/NextApi/apiClient/GetQuoteApi", qs) as {
          grapthData?: unknown[];
          graphData?: unknown[];
          equityResponse?: unknown[];
        };
        logger.debug({ msg: 'Raw NSE response', symbol, responseSize: JSON.stringify(rawData).length });

        const data = (rawData?.equityResponse?.[0] || rawData) as {
          metaData?: any;
          tradeInfo?: any;
          priceInfo?: any;
          secInfo?: any;
          grapthData?: unknown[];
          graphData?: unknown[];
        };

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

        logger.info({ msg: 'Stock quote mapped successfully', symbol, lastPrice: quote.lastPrice });
        return quote;
    };

    const pollingConfig = enablePolling ? cacheConfig.pollingConfig : undefined;
    const quote = await enhancedCache.getWithCache(cacheConfig, fetchQuote, pollingConfig);

    if (enablePolling) {
        marketDataPoller.startPolling(symbol, 'stock');
    }

    return quote;
}

/**
 * Get stock chart data from NSE
 * API: /api/NextApi/apiClient/GetQuoteApi?functionName=getSymbolChartData&symbol=SBINEQN&days=1D
 */
export async function getStockChart(symbol: string, days: string = "1D"): Promise<unknown[]> {
    const cacheConfig = nseCache.stockChart(symbol, days);

    const fetchChart = async (): Promise<unknown[]> => {
        // Need to get identifier first (e.g., SBINEQN for SBIN)
        const quote = await getStockQuote(symbol);
        const identifier = quote.identifier || `${symbol}EQN`;

        const qs = `?functionName=getSymbolChartData&symbol=${encodeURIComponent(identifier)}&days=${days}`;

        logger.info({ msg: 'Fetching stock chart from NSE', symbol, identifier, days });

        const rawData = await nseFetch("/api/NextApi/apiClient/GetQuoteApi", qs) as {
          grapthData?: unknown[];
          graphData?: unknown[];
        };
        const chartData = rawData?.grapthData || rawData?.graphData || [];

        logger.info({ msg: 'Stock chart data fetched', symbol, days, dataPoints: chartData.length });
        return chartData;
    };

    try {
        return await enhancedCache.getWithCache(cacheConfig, fetchChart);
    } catch (e) {
        logger.error({ msg: 'Failed to fetch stock chart', symbol, days, error: e instanceof Error ? e.message : String(e) });
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
        const rawData = await nseFetch("/api/NextApi/apiClient/GetQuoteApi", qs) as {
          grapthData?: unknown[];
          graphData?: unknown[];
          data?: unknown[];
        };
        const trends = rawData?.data || [];

        cache.set(cacheKey, trends, 3600); // 1 hour
        return trends;
    } catch (e) {
        console.error(`[Stock Service] Error fetching trends for ${symbol}:`, e);
        return [];
    }
}
