import cache from "@/lib/cache";
import { nseFetch } from "@/lib/nse-client";
import { enhancedCache, nseCache, marketDataPoller } from "@/lib/enhanced-cache";
import logger from "@/lib/logger";
import { FinancialStatusDTO, CorpEventDTO, CorporateAnnouncementDTO, CorpActionDTO } from "@/lib/nse/dto";
import * as syncService from "@/lib/services/sync-service";
import { isMarketOpen, getRecommendedTTL } from "@/lib/market-hours";
import prisma from "@/lib/prisma";

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
    averagePrice: number;
    closePrice: number;
}

/**
 * Get stock quote data from NSE
 * API: /api/NextApi/apiClient/GetQuoteApi?functionName=getSymbolData&marketType=N&series=EQ&symbol=SBIN
 */
export async function getStockQuote(symbol: string, enablePolling: boolean = false): Promise<StockQuote> {
    const cacheConfig = nseCache.stockQuote(symbol);

    // If market is closed, try DB first to avoid unnecessary NSE calls
    if (!isMarketOpen()) {
        const cachedInCache = cacheConfig.cacheInstance?.get(cacheConfig.key);
        if (cachedInCache) return cachedInCache as StockQuote;

        try {
            // Get the latest price
            const dbPrice = await prisma.dailyPrice.findFirst({
                where: { ticker: symbol.toUpperCase() },
                orderBy: { tradeDate: 'desc' }
            });

            // Get 52W high/low from DB (last 365 days)
            const oneYearAgo = new Date();
            oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
            
            const yearStats = await prisma.dailyPrice.aggregate({
                where: { 
                    ticker: symbol.toUpperCase(),
                    tradeDate: { gte: oneYearAgo }
                },
                _max: { high: true },
                _min: { low: true },
            });

            if (dbPrice) {
                // Return a partial quote from DB data if available
                logger.debug({ msg: 'Using DB data for closed market quote', symbol });
                
                // Calculate approximate traded value from volume and close price
                const dailyVolume = dbPrice.volume ? Number(dbPrice.volume) : 0;
                const dailyClose = Number(dbPrice.close || 0);
                const approximateValue = dailyVolume * dailyClose; // Approximate in rupees

                // Calculate change and pChange from previous day's close
                const prevDayPrice = await prisma.dailyPrice.findFirst({
                    where: { 
                        ticker: symbol.toUpperCase(),
                        tradeDate: { lt: dbPrice.tradeDate }
                    },
                    orderBy: { tradeDate: 'desc' }
                });
                
                const previousClose = prevDayPrice ? Number(prevDayPrice.close) : dailyClose;
                const change = dailyClose - previousClose;
                const pChange = previousClose > 0 ? (change / previousClose) * 100 : 0;

                const quote: Partial<StockQuote> = {
                    symbol: symbol.toUpperCase(),
                    lastPrice: dailyClose,
                    open: Number(dbPrice.open || 0),
                    dayHigh: Number(dbPrice.high || 0),
                    dayLow: Number(dbPrice.low || 0),
                    closePrice: dailyClose,
                    previousClose: previousClose,
                    change: change,
                    pChange: pChange,
                    // Calculate 52W high/low from DB
                    yearHigh: yearStats._max.high ? Number(yearStats._max.high) : undefined,
                    yearLow: yearStats._min.low ? Number(yearStats._min.low) : undefined,
                    // Use latest day's volume
                    totalTradedVolume: dailyVolume > 0 ? dailyVolume : undefined,
                    // Calculate approximate traded value
                    totalTradedValue: approximateValue > 0 ? approximateValue : undefined,
                };

                // Cache it until open
                cacheConfig.cacheInstance?.set(cacheConfig.key, quote as StockQuote, Math.floor(getRecommendedTTL(120000) / 1000));
                return quote as StockQuote;
            }
        } catch (err) {
            logger.warn({ msg: 'DB lookup failed for quote', symbol, error: err });
        }
    }

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
            averagePrice: parseFloat(metaData.averagePrice || 0),
            closePrice: parseFloat(metaData.closePrice || 0),
        };

        logger.info({ msg: 'Stock quote mapped successfully', symbol, lastPrice: quote.lastPrice });

        // Background sync to DB for DailyPrice
        (async () => {
            try {
                await prisma.dailyPrice.upsert({
                    where: {
                        ticker_tradeDate: {
                            ticker: quote.symbol,
                            tradeDate: new Date(new Date().setHours(0, 0, 0, 0))
                        }
                    },
                    update: {
                        open: quote.open,
                        high: quote.dayHigh,
                        low: quote.dayLow,
                        close: quote.lastPrice,
                    },
                    create: {
                        ticker: quote.symbol,
                        tradeDate: new Date(new Date().setHours(0, 0, 0, 0)),
                        open: quote.open,
                        high: quote.dayHigh,
                        low: quote.dayLow,
                        close: quote.lastPrice,
                    }
                });
            } catch (e) {
                logger.error({ msg: "DailyPrice sync failed", symbol: quote.symbol, error: e });
            }
        })();

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

interface NSETrendItem {
    year: string;
    [key: string]: unknown;
}

/**
 * Get stock yearwise trend data from NSE
 * API: /api/NextApi/apiClient/GetQuoteApi?functionName=getYearwiseData&symbol=SBINEQN
 */
export async function getStockTrends(symbol: string): Promise<NSETrendItem[]> {
    const cacheKey = `nse:stock:${symbol}:trends`;
    const cached = cache.get(cacheKey);
    if (cached) return cached as NSETrendItem[];

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
        const trends = (rawData?.data || []) as NSETrendItem[];

        const ttl = isMarketOpen() ? 3600 : Math.floor(getRecommendedTTL(3600000) / 1000);
        cache.set(cacheKey, trends, ttl);
        return trends;
    } catch (e) {
        logger.error(`[Stock Service] Error fetching trends for ${symbol}:`, e);
        return [];
    }
}

/**
 * Get financial status for a symbol
 */
export async function getFinancialStatus(symbol: string): Promise<FinancialStatusDTO | null> {
    const config = nseCache.corporate(symbol, "financials");

    const fetchFn = async (): Promise<FinancialStatusDTO | null> => {
        const qs = `?functionName=getFinancialStatus&symbol=${encodeURIComponent(symbol)}`;
        const data = await nseFetch("/api/NextApi/apiClient/GetQuoteApi", qs) as FinancialStatusDTO;

        // Background sync to DB
        syncService.syncFinancials(symbol, data).catch(err =>
            logger.error({ msg: "Financial sync failed", symbol, error: err })
        );

        return data;
    };

    try {
        return await enhancedCache.getWithCache(config, fetchFn);
    } catch (e) {
        logger.error(`[Stock Service] Error fetching financial status for ${symbol}:`, e);
        return null;
    }
}

/**
 * Get corporate event calendar
 */
export async function getCorpEvents(symbol: string): Promise<CorpEventDTO[]> {
    const config = nseCache.corporate(symbol, "events");

    const fetchFn = async (): Promise<CorpEventDTO[]> => {
        const qs = `?functionName=getCorpEventCalender&symbol=${encodeURIComponent(symbol)}&noOfRecords=3&marketApiType=equities`;
        const rawData = await nseFetch("/api/NextApi/apiClient/GetQuoteApi", qs);
        return (Array.isArray(rawData) ? rawData : rawData?.data || []) as CorpEventDTO[];
    };

    try {
        return await enhancedCache.getWithCache(config, fetchFn);
    } catch (e) {
        logger.error(`[Stock Service] Error fetching corp events for ${symbol}:`, e);
        return [];
    }
}

/**
 * Get corporate announcements
 */
export async function getCorporateAnnouncements(symbol: string): Promise<CorporateAnnouncementDTO[]> {
    const config = nseCache.corporate(symbol, "announcements");

    const fetchFn = async (): Promise<CorporateAnnouncementDTO[]> => {
        const qs = `?functionName=getCorporateAnnouncement&symbol=${encodeURIComponent(symbol)}&marketApiType=equities&noOfRecords=3`;
        const rawData = await nseFetch("/api/NextApi/apiClient/GetQuoteApi", qs);
        const data = (Array.isArray(rawData) ? rawData : rawData?.data || []) as CorporateAnnouncementDTO[];

        // Background sync to DB
        syncService.syncAnnouncements(symbol, data).catch(err =>
            logger.error({ msg: "Announcements sync failed", symbol, error: err })
        );

        return data;
    };

    try {
        return await enhancedCache.getWithCache(config, fetchFn);
    } catch (e) {
        logger.error(`[Stock Service] Error fetching announcements for ${symbol}:`, e);
        return [];
    }
}

/**
 * Get corporate actions
 */
export async function getCorpActions(symbol: string): Promise<CorpActionDTO[]> {
    const config = nseCache.corporate(symbol, "actions");

    const fetchFn = async (): Promise<CorpActionDTO[]> => {
        const qs = `?functionName=getCorpAction&symbol=${encodeURIComponent(symbol)}&marketApiType=equities&noOfRecords=3`;
        const rawData = await nseFetch("/api/NextApi/apiClient/GetQuoteApi", qs);
        const data = (Array.isArray(rawData) ? rawData : rawData?.data || []) as CorpActionDTO[];

        // Background sync to DB
        syncService.syncActions(symbol, data).catch(err =>
            logger.error({ msg: "Actions sync failed", symbol, error: err })
        );

        return data;
    };

    try {
        return await enhancedCache.getWithCache(config, fetchFn);
    } catch (e) {
        logger.error(`[Stock Service] Error fetching corp actions for ${symbol}:`, e);
        return [];
    }
}
