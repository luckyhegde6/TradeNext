import cache from "@/lib/cache";
import { nseFetch } from "@/lib/nse-client";
import { enhancedCache, nseCache, marketDataPoller } from "@/lib/enhanced-cache";
import logger from "@/lib/logger";
import { FinancialStatusDTO, CorpEventDTO, CorporateAnnouncementDTO, CorpActionDTO } from "@/lib/nse/dto";
import * as syncService from "@/lib/services/sync-service";
import { isMarketOpen, getRecommendedTTL } from "@/lib/market-hours";
import prisma, { getIstDayKey, withAccelerateCache } from "@/lib/prisma";
import {
  getSqliteDailyPriceSnapshot,
  cacheDailyPriceSnapshot,
} from "@/lib/sqlite";

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

// ─── Daily price snapshot → partial quote (tier-2 SQLite read) ─────────────
// Builds a partial StockQuote from a cached daily price snapshot (open/high/
// low/close/volume only). Used when market is closed to avoid the 3-read
// Prisma bundle for every symbol on every SSE poll.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildQuoteFromSnapshot(symbol: string, snap: { open: number; high: number; low: number; close: number; volume: number }): Partial<StockQuote> {
    const dailyClose = snap.close || 0;
    const dailyVolume = snap.volume || 0;
    return {
        symbol: symbol.toUpperCase(),
        lastPrice: dailyClose,
        open: snap.open || 0,
        dayHigh: snap.high || 0,
        dayLow: snap.low || 0,
        closePrice: dailyClose,
        previousClose: dailyClose,
        change: 0,
        pChange: 0,
        totalTradedVolume: dailyVolume > 0 ? dailyVolume : undefined,
        totalTradedValue: dailyVolume > 0 ? dailyVolume * dailyClose : undefined,
        // Use last-known close as a floor for year high/low until Prisma fills in
        yearHigh: snap.high || undefined,
        yearLow: snap.low || undefined,
    };
}

// ─── Sync daily price once per symbol per IST trading day ───────────────────
// User directive: "do not do a db write for every NSE fetch during after
// market hours ... only sync if DB is out of sync during the market open
// status." Implemented as a globalThis Set keyed `${IST day}:${symbol}` — the
// NSE-fetched upsert to `daily_prices` runs at most ONCE per symbol per trading
// day, and only while the market is open (zero Prisma writes after hours). If
// the upsert fails the key is removed so a later fetch retries.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any;
if (!g.__dailyPriceSynced) g.__dailyPriceSynced = new Set<string>();
const dailyPriceSynced: Set<string> = g.__dailyPriceSynced;

async function syncDailyPriceOnce(symbol: string, quote: StockQuote): Promise<void> {
    const day = getIstDayKey();
    const key = `${day}:${symbol.toUpperCase()}`;
    if (!isMarketOpen()) return; // no DB write after hours — cache/SQLite only
    if (dailyPriceSynced.has(key)) return; // already seeded this trading day
    try {
        await prisma.dailyPrice.upsert({
            where: {
                ticker_tradeDate: {
                    ticker: symbol.toUpperCase(),
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
                ticker: symbol.toUpperCase(),
                tradeDate: new Date(new Date().setHours(0, 0, 0, 0)),
                open: quote.open,
                high: quote.dayHigh,
                low: quote.dayLow,
                close: quote.lastPrice,
            }
        });
        dailyPriceSynced.add(key);
    } catch (e) {
        // Remove so a later fetch retries — don't silently lose the sync
        dailyPriceSynced.delete(key);
        logger.error({ msg: "DailyPrice sync failed", symbol: quote.symbol, error: e });
    }
}

/**
 * Get stock quote data from NSE
 * API: /api/NextApi/apiClient/GetQuoteApi?functionName=getSymbolData&marketType=N&series=EQ&symbol=SBIN
 */
export async function getStockQuote(symbol: string, enablePolling: boolean = false): Promise<StockQuote> {
    const cacheConfig = nseCache.stockQuote(symbol);

    // If market is closed, try cache → SQLite → Prisma to avoid unnecessary NSE calls
    if (!isMarketOpen()) {
        const cachedInCache = cacheConfig.cacheInstance?.get(cacheConfig.key);
        if (cachedInCache) return cachedInCache as StockQuote;

        // Tier 2: SQLite snapshot (zero Prisma ops — v3.21.x quote tiering)
        const snapshot = getSqliteDailyPriceSnapshot(symbol);
        if (snapshot) {
            const quote = buildQuoteFromSnapshot(symbol, snapshot);
            cacheConfig.cacheInstance?.set(cacheConfig.key, quote as StockQuote, Math.floor(getRecommendedTTL(120000) / 1000));
            return quote as StockQuote;
        }

        try {
            // Get the latest price (edge-cached: quotes are high-frequency and
            // read-only; 60s TTL + 30s SWR near the user)
            const dbPrice = await prisma.dailyPrice.findFirst(withAccelerateCache({ ttl: 60, swr: 30 })({
                where: { ticker: symbol.toUpperCase() },
                orderBy: { tradeDate: 'desc' }
            }));

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
                const prevDayPrice = await prisma.dailyPrice.findFirst(withAccelerateCache({ ttl: 60, swr: 30 })({
                    where: { 
                        ticker: symbol.toUpperCase(),
                        tradeDate: { lt: dbPrice.tradeDate }
                    },
                    orderBy: { tradeDate: 'desc' }
                }));
                
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

        // Sync to DB only once per symbol per IST trading day AND only during
        // market hours (v3.21.x — no per-fetch write flood, no after-hours writes).
        // Also warm the SQLite snapshot tier so closed-market reads resolve
        // from cache → SQLite without hitting Prisma.
        syncDailyPriceOnce(quote.symbol, quote).catch(() => {});
        cacheDailyPriceSnapshot({
            symbol: quote.symbol,
            tradeDate: new Date().toISOString().split("T")[0],
            open: quote.open,
            high: quote.dayHigh,
            low: quote.dayLow,
            close: quote.lastPrice,
            volume: quote.totalTradedVolume || 0,
        });

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
 * Get corporate actions from database with pagination
 */
export async function getCorpActionsFromDB(options: {
    symbol?: string;
    actionType?: string;
    page?: number;
    limit?: number;
}): Promise<{
    data: unknown[];
    total: number;
    page: number;
    totalPages: number
}> {
    const { symbol, actionType, page = 1, limit = 20 } = options;

    const where: Record<string, unknown> = {};
    
    if (symbol) {
        where.symbol = symbol.toUpperCase();
    }
    
    if (actionType && actionType !== "all") {
        where.actionType = actionType;
    }

    const [data, total] = await Promise.all([
        prisma.corporateAction.findMany({
            where,
            orderBy: { exDate: "desc" },
            skip: (page - 1) * limit,
            take: limit,
        }),
        prisma.corporateAction.count({ where })
    ]);

    return {
        data,
        total,
        page,
        totalPages: Math.ceil(total / limit)
    };
}

/**
 * Get corporate actions from NSE API
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
