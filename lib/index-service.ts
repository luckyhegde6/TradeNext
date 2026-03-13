import prisma from "@/lib/prisma";
import cache, { staticCache } from "@/lib/cache"; // NodeCache
import { nseFetch } from "@/lib/nse-client";
import { MARKET_HOLIDAYS } from "@/lib/constants";
import { isMarketOpen, getRecommendedTTL } from "@/lib/market-hours";
import logger from "@/lib/logger";
import type { IndexQuote } from "@prisma/client";

const INDEX_MAPPING: Record<string, string> = {
    'NIFTY 50': 'NIFTY 50',
    'NIFTY BANK': 'NIFTY BANK',
    'NIFTY IT': 'NIFTY IT',
    'NIFTY NEXT 50': 'NIFTY NEXT 50',
    'NIFTY MIDCAP 50': 'NIFTY MIDCAP 50',
    'NIFTY SMALLCAP 100': 'NIFTY SMALLCAP 100',
    'INDIA VIX': 'INDIA VIX',
    'NIFTY AUTO': 'NIFTY AUTO',
    'NIFTY PHARMA': 'NIFTY PHARMA',
};

// Helper to get the target "trading day" for chart
function getTargetDate() {
    const now = new Date();
    // If today is a trading day and time is past market start, use today.
    // If weekend, fallback.
    const day = now.getDay();
    if (day === 0) { // Sunday -> Friday
        const d = new Date(now); d.setDate(now.getDate() - 2); return d;
    }
    if (day === 6) { // Saturday -> Friday
        const d = new Date(now); d.setDate(now.getDate() - 1); return d;
    }
    return now;
}

function parseNseDate(dateStr: string): Date {
    // Format: "05-Dec-2025 15:30" or "05-Dec-2025"
    if (!dateStr) return new Date();
    return new Date(dateStr);
}

export async function getIndexChartData(indexName: string, timeframe: string = '1D') {
    const cacheKey = `nse:index:${indexName}:chart:${timeframe}`;

    // For 1D data, we can try to get from DB first
    if (timeframe === '1D') {
        const targetDate = getTargetDate();
        const startOfDay = new Date(targetDate); startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(targetDate); endOfDay.setHours(23, 59, 59, 999);

        let dbCount = 0;
        try {
            const countPromise = prisma.indexPoint.count({
                where: { indexName: indexName, time: { gte: startOfDay, lte: endOfDay } }
            });
            const timeoutPromise = new Promise<number>((_, reject) =>
                setTimeout(() => reject(new Error('Database count timeout')), 3000)
            );
            dbCount = await Promise.race([countPromise, timeoutPromise]);
        } catch (dbError) {
            console.warn(`Database count query failed for ${indexName}:`, dbError instanceof Error ? dbError.message : dbError);
            dbCount = 0;
        }

        if (dbCount > 10) {
            const points = await prisma.indexPoint.findMany({
                where: { indexName: indexName, time: { gte: startOfDay, lte: endOfDay } },
                orderBy: { time: 'asc' }
            });
            const grapthData = points.map(p => [p.time.getTime(), Number(p.close)]);
            return { grapthData };
        }
    }

    // Check cache
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    // Fetch from NSE
    const nseSymbol = INDEX_MAPPING[indexName] || indexName;
    const qs = `?functionName=getGraphChart&&type=${encodeURIComponent(nseSymbol)}&flag=${timeframe}`;
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rawData = await nseFetch("/api/NextApi/apiClient", qs) as any;

        const grapthData = rawData?.data?.grapthData || rawData?.grapthData || [];
        const normalizedData = { grapthData };

        // Cache: 1 minute for intraday, 1 hour for historical
        const ttl = timeframe === '1D' ? 60 : 3600;
        cache.set(cacheKey, normalizedData, ttl);

        // Hydroate DB only for 1D intraday data
        if (timeframe === '1D' && Array.isArray(grapthData) && grapthData.length > 0) {
            (async () => {
                try {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const records = grapthData.map((p: any) => ({
                        indexName,
                        time: new Date(p[0]),
                        close: p[1],
                    }));
                    await prisma.indexPoint.createMany({ data: records, skipDuplicates: true });
                } catch (err) {
                    console.error("Error hydrating index points:", err);
                }
            })();
        }

        return normalizedData;
    } catch (e) {
        console.error(
            "Failed to fetch index chart for index %s with timeframe %s:",
            indexName,
            timeframe,
            e
        ); return { grapthData: [] };
    }
}

export async function getIndexDetails(indexName: string, enablePolling: boolean = false) {
    let dbQuote = null;
    try {
        // Add timeout to database query to prevent hanging
        const queryPromise = prisma.indexQuote.findUnique({ where: { indexName } });
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Database query timeout')), 5000)
        );

        dbQuote = await Promise.race([queryPromise, timeoutPromise]) as IndexQuote | null;
        if (dbQuote) {
            const lastUpdate = dbQuote.updatedAt.getTime();
            const now = Date.now();

            // If market is closed, DB data is likely the last available data and thus "fresh"
            // However, if we are using a remote DB (Prisma Accelerate), we might want to be more careful
            const isStale = (now - lastUpdate) > (process.env.USE_REMOTE_DB === 'true' ? 60000 : 120000);

            if (!isStale || (!isMarketOpen() && (now - lastUpdate) < 3600000)) {
                logger.debug({ msg: 'Using DB data for index details', indexName, marketOpen: isMarketOpen() });
                return dbQuote;
            }
        }
    } catch (dbError) {
        logger.warn({
            msg: 'Database query failed for index, falling back to NSE',
            indexName,
            error: dbError instanceof Error ? dbError.message : String(dbError)
        });
    }

    // Check cache first
    const cacheKey = `nse:index:${indexName}:quote`;
    const cached = cache.get(cacheKey);
    if (cached) {
        logger.debug({ msg: 'Cache hit for index details', indexName });
        return cached;
    }

    const fetchIndexDetails = async () => {
        const qs = `?functionName=getIndexData&&index=${encodeURIComponent(indexName)}`;

        logger.info({ msg: 'Fetching index details from NSE', indexName });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rawData = await nseFetch("/api/NextApi/apiClient/indexTrackerApi", qs) as any;
        const data = rawData?.data?.[0] || rawData?.[0] || {};

        // Ensure numeric values for calculations
        const lastPrice = parseFloat(data.lastPrice || data.last || 0);
        const previousClose = parseFloat(data.previousClose || data.prevClose || 0);
        const percChange = parseFloat(data.percChange || data.percentChange || 0);

        // Calculate change properly (lastPrice - previousClose)
        const change = lastPrice - previousClose;

        const quote = {
            indexName: data.indexName || indexName,
            lastPrice: String(lastPrice),
            change: String(change),
            pChange: String(percChange),
            open: String(data.open || 0),
            high: String(data.dayHigh || data.high || 0),
            low: String(data.dayLow || data.low || 0),
            previousClose: String(data.previousClose || data.prevClose || 0),
            yearHigh: String(data.yearHigh || 0),
            yearLow: String(data.yearLow || 0),
            peRatio: String(data.pe || data.peRatio || 0),
            pbRatio: String(data.pb || data.pbRatio || 0),
            dividendYield: String(data.dividendYield || 0),
            marketStatus: data.marketStatus || (isMarketOpen() ? 'Open' : 'Closed'),
            advances: data.advances || 0,
            declines: data.declines || 0,
            unchanged: data.unchanged || 0,
            totalTradedVolume: String(data.totalTradedVolume || 0),
            totalTradedValue: String(data.totalTradedValue || 0),
            timestamp: data.timeVal ? new Date(data.timeVal).toISOString() : new Date().toISOString(),
        };

        // Cache the result with market-aware TTL
        const ttl = isMarketOpen() ? 120 : Math.floor(getRecommendedTTL(120000) / 1000);
        cache.set(cacheKey, quote, ttl);

        // Async database hydration
        (async () => {
            try {
                await prisma.indexQuote.upsert({
                    where: { indexName },
                    update: quote,
                    create: { ...quote, id: undefined }
                });
            } catch (err) {
                logger.warn({ msg: 'DB upsert error for index details', indexName, error: err });
            }
        })();

        return quote;
    };

    try {
        return await fetchIndexDetails();
    } catch (e) {
        logger.error({
            msg: 'Failed to fetch index details',
            indexName,
            error: e instanceof Error ? e.message : String(e)
        });

        if (dbQuote) {
            logger.info({ msg: 'Returning cached DB data due to API failure', indexName });
            return dbQuote;
        }

        // Return a fallback response instead of throwing error
        logger.warn({ msg: 'Index not available, returning fallback data', indexName });
        return {
            indexName,
            lastPrice: "0",
            change: "0",
            pChange: "0",
            open: "0",
            high: "0",
            low: "0",
            previousClose: "0",
            yearHigh: "0",
            yearLow: "0",
            peRatio: "0",
            pbRatio: "0",
            dividendYield: "0",
            marketStatus: "Closed",
            advances: 0,
            declines: 0,
            unchanged: 0,
            totalTradedVolume: "0",
            totalTradedValue: "0",
            timestamp: new Date().toISOString(),
        };
    }
}

interface NSEIndexConstituent {
    cmSymbol?: string;
    symbol?: string;
    lasttradedPrice?: number;
    lastPrice?: number;
    last?: number;
    change?: number;
    pchange?: number;
    pChange?: number;
    totaltradedquantity?: number;
    tradedVolume?: number;
    totalTradedVolume?: number | string;
    totaltradedvalue?: number;
    tradedValue?: number;
    totalTradedValue?: number;
    high?: number;
    dayHigh?: number;
    low?: number;
    dayLow?: number;
    yearHigh?: number;
    yearLow?: number;
}

export async function getIndexHeatmap(indexName: string) {
    const cacheKey = `nse:index:${indexName}:heatmap`;
    const cached = cache.get(cacheKey); // Use regular cache for heatmap data
    if (cached) {
        return cached as NSEIndexConstituent[];
    }

    const qs = `?functionName=getConstituents&&index=${encodeURIComponent(indexName)}&&noofrecords=0`;
    try {
        logger.info({ msg: 'Fetching heatmap data from NSE', indexName });

        const rawData = await nseFetch("/api/NextApi/apiClient/indexTrackerApi", qs) as { data?: NSEIndexConstituent[] };
        const items = rawData?.data || [];

        logger.info({ msg: 'Heatmap data fetched', indexName, count: items.length });

        const ttl = isMarketOpen() ? 300 : Math.floor(getRecommendedTTL(300000) / 1000);
        cache.set(cacheKey, items, ttl);

        // Async Hydrate (don't fail the request if DB is unavailable)
        (async () => {
            try {
                for (const item of items) {
                    // Use cmSymbol as the symbol field
                    const symbol = item.cmSymbol || item.symbol;

                    // Skip if symbol is missing or undefined
                    if (!symbol) {
                        logger.warn({ msg: 'Skipping heatmap item without symbol', item });
                        continue;
                    }

                    // Map NSE API fields to our schema
                    const lastPrice = item.lasttradedPrice || item.lastPrice || item.last || 0;
                    const change = item.change || 0;
                    const pChange = item.pchange || item.pChange || 0;
                    const volume = item.totaltradedquantity || item.tradedVolume || item.totalTradedVolume;
                    const value = item.totaltradedvalue || item.tradedValue || item.totalTradedValue || 0;

                    // Ensure no decimal errors - USE symbol VARIABLE
                    await prisma.indexHeatmapItem.upsert({
                        where: {
                            indexName_symbol: { indexName, symbol }
                        },
                        update: {
                            lastPrice,
                            change,
                            pChange,
                            volume: volume ? BigInt(Math.floor(Number(volume) * 100000)) : undefined,
                            value,
                            high: item.high || item.dayHigh || 0,
                            low: item.low || item.dayLow || 0,
                            yearHigh: item.yearHigh,
                            yearLow: item.yearLow,
                        },
                        create: {
                            indexName,
                            symbol,
                            lastPrice,
                            change,
                            pChange,
                            volume: volume ? BigInt(Math.floor(Number(volume) * 100000)) : undefined,
                            value,
                            high: item.high || item.dayHigh || 0,
                            low: item.low || item.dayLow || 0,
                        }
                    });
                }
            } catch (err) {
                logger.warn({
                    msg: 'Heatmap DB Hydration Error',
                    indexName,
                    error: err instanceof Error ? err.message : String(err)
                });
            }
        })();

        return items;
    } catch (e) {
        logger.error({
            msg: 'Heatmap fetch error, falling back to DB',
            indexName,
            error: e instanceof Error ? e.message : String(e)
        });

        // Fallback to DB - return all items
        const dbItems = await prisma.indexHeatmapItem.findMany({
            where: { indexName }
        });

        return dbItems.map(item => ({
            symbol: item.symbol,
            lastPrice: item.lastPrice,
            change: item.change,
            pChange: item.pChange,
            volume: item.volume ? Number(item.volume) / 100000 : 0,
            value: item.value,
            high: item.high,
            low: item.low,
        }));
    }
}

export async function getIndexCorporateActions(indexName: string) {
    const cacheKey = `nse:index:${indexName}:corpactions`;
    const cached = staticCache.get(cacheKey); // Use static cache for corporate actions
    if (cached) return cached;

    try {
        // Use the new URL provided by the user for all equities corporate actions
        const data = await nseFetch("https://www.nseindia.com/api/corporates-corporateActions?index=equities") as any;

        // If data is an array, we might want to filter by index constituents if indexName is not "all"
        // For now, return all as it used to do but with the new API
        const actions = Array.isArray(data) ? data : (data?.data || []);

        const ttl = isMarketOpen() ? 1800 : Math.floor(getRecommendedTTL(1800000) / 1000);
        staticCache.set(cacheKey, actions, ttl);
        return actions;
    } catch (e) {
        // Log specific error types
        if (e instanceof Error && e.message.includes('404')) {
            console.warn(`Corporate actions not available for ${indexName} (API returned 404)`);
        } else {
            console.error("Corporate actions fetch error", e);
        }
        return [];
    }
}

export async function getIndexAnnouncements(indexName: string) {
    const cacheKey = `nse:index:${indexName}:announcements`;
    const cached = staticCache.get(cacheKey); // Use static cache for announcements
    if (cached) return cached;

    const qs = `?functionName=getAnnouncementsIndices&flag=CAN&&index=${encodeURIComponent(indexName)}`;
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rawData = await nseFetch("/api/NextApi/apiClient/indexTrackerApi", qs) as any;
        const data = rawData?.data || [];

        // Sort by broadcastDateTime descending
        // eslint-disable-next-line
        const sorted = data.sort((a: any, b: any) => {
            const dateA = parseNseDate(a.broadcastDate);
            const dateB = parseNseDate(b.broadcastDate);
            return dateB.getTime() - dateA.getTime();
        });

        const ttl = isMarketOpen() ? 1800 : Math.floor(getRecommendedTTL(1800000) / 1000);
        staticCache.set(cacheKey, sorted, ttl);

        // Async DB hydration (don't fail the request if DB is unavailable)
        (async () => {
            try {
                for (const item of data) {
                    const broadcastDate = parseNseDate(item.broadcastDate);
                    const exists = await prisma.corporateAnnouncement.count({
                        where: {
                            symbol: item.symbol,
                            broadcastDateTime: broadcastDate
                        }
                    });
                    if (exists === 0) {
                        await prisma.corporateAnnouncement.create({
                            data: {
                                symbol: item.symbol,
                                companyName: item.companyName,
                                subject: item.subject,
                                details: item.details,
                                broadcastDateTime: broadcastDate,
                                attachment: item.attachment,
                            }
                        });
                    }
                }
            } catch (err) {
                console.warn("Announcements DB Error (continuing without saving to DB):", err);
            }
        })();

        return sorted;
    } catch (e) {
        console.error("Announcements fetch error", e);
        return [];
    }
}

/**
 * Get advance/decline data for an index
 * API: /api/NextApi/apiClient/indexTrackerApi?functionName=getAdvanceDecline&&index=NIFTY%2050
 */
export async function getAdvanceDecline(indexName: string) {
    const cacheKey = `nse:index:${indexName}:advdec`;
    const cached = cache.get(cacheKey); // Use regular cache for advance/decline data
    if (cached) return cached;

    const qs = `?functionName=getAdvanceDecline&&index=${encodeURIComponent(indexName)}`;
    try {
        console.log(`[Index Service] Fetching advance/decline for ${indexName}`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rawData = await nseFetch("/api/NextApi/apiClient/indexTrackerApi", qs) as any;
        const data = rawData?.data?.[0] || {};

        const result = {
            indexName: data.indexName || indexName,
            advances: data.advance_symbol || 0,
            declines: data.decline_symbol || 0,
            unchanged: data.unchanged_symbol || 0,
            total: data.total_symbol || 0,
            advanceTurnover: data.advance_top_turnover || 0,
            declineTurnover: data.decline_top_turnover || 0,
            unchangedTurnover: data.unchanged_top_turnover || 0,
            totalTurnover: data.total_top_turnover || 0,
        };

        console.log(`[Index Service] Advance/Decline result:`, result);

        const ttl = isMarketOpen() ? 300 : Math.floor(getRecommendedTTL(300000) / 1000);
        cache.set(cacheKey, result, ttl);
        return result;
    } catch (e) {
        console.error(`[Index Service] Error fetching advance/decline for ${indexName}:`, e);
        return {
            indexName,
            advances: 0,
            declines: 0,
            unchanged: 0,
            total: 0,
            advanceTurnover: 0,
            declineTurnover: 0,
            unchangedTurnover: 0,
            totalTurnover: 0,
        };
    }
}

// =============================================================================
// Historical Data Fetching Functions (New v1.6.0)
// =============================================================================

/**
 * Get corporate actions from NSE with date range support
 * Daily: https://www.nseindia.com/api/corporates-corporateActions?index=equities
 * Historical: https://www.nseindia.com/api/corporates-corporateActions?index=equities&from_date=13-03-2025&to_date=13-03-2026
 */
export async function getCorporateActionsHistorical(fromDate?: string, toDate?: string) {
    const cacheKey = `nse:corpActions:historical:${fromDate || 'daily'}:${toDate || 'daily'}`;
    const cached = staticCache.get(cacheKey);
    if (cached) return cached;

    try {
        let url = "https://www.nseindia.com/api/corporates-corporateActions?index=equities";
        
        // Add date range if provided
        if (fromDate && toDate) {
            url = `https://www.nseindia.com/api/corporates-corporateActions?index=equities&from_date=${fromDate}&to_date=${toDate}`;
        }

        logger.info({ msg: 'Fetching corporate actions from NSE', fromDate, toDate, url: url.split('?')[1] });
        
        const data = await nseFetch(url) as any;
        const actions = Array.isArray(data) ? data : (data?.data || []);

        // Cache for 1 hour
        const ttl = 3600;
        staticCache.set(cacheKey, actions, ttl);

        logger.info({ msg: 'Corporate actions fetched', count: actions.length, fromDate, toDate });
        return actions;
    } catch (e) {
        logger.error({ msg: 'Corporate actions historical fetch error', fromDate, toDate, error: e });
        return [];
    }
}

/**
 * Get corporate announcements from NSE
 * API: https://www.nseindia.com/api/corporate-announcements?index=equities
 */
export async function getCorporateAnnouncements(symbol?: string, fromDate?: string, toDate?: string) {
    const cacheKey = `nse:announcements:${symbol || 'all'}:${fromDate || 'daily'}:${toDate || 'daily'}`;
    const cached = staticCache.get(cacheKey);
    if (cached) return cached;

    try {
        let url = "https://www.nseindia.com/api/corporate-announcements?index=equities";
        
        // Add filters if provided
        const params = new URLSearchParams();
        if (symbol) params.set('symbol', symbol);
        if (fromDate) params.set('from_date', fromDate);
        if (toDate) params.set('to_date', toDate);
        
        if (params.toString()) {
            url += '&' + params.toString();
        }

        logger.info({ msg: 'Fetching corporate announcements from NSE', symbol, fromDate, toDate });
        
        const data = await nseFetch(url) as any;
        const announcements = Array.isArray(data) ? data : (data?.data || []);

        // Cache for 1 hour
        const ttl = 3600;
        staticCache.set(cacheKey, announcements, ttl);

        logger.info({ msg: 'Corporate announcements fetched', count: announcements.length, symbol, fromDate, toDate });
        return announcements;
    } catch (e) {
        logger.error({ msg: 'Corporate announcements fetch error', symbol, fromDate, toDate, error: e });
        return [];
    }
}

/**
 * Get event calendar from NSE
 * Daily: https://www.nseindia.com/api/event-calendar?
 * Historical: https://www.nseindia.com/api/event-calendar?index=equities&from_date=13-03-2025&to_date=13-03-2026
 */
export async function getEventCalendar(fromDate?: string, toDate?: string) {
    const cacheKey = `nse:eventCalendar:${fromDate || 'daily'}:${toDate || 'daily'}`;
    const cached = staticCache.get(cacheKey);
    if (cached) return cached;

    try {
        let url = "https://www.nseindia.com/api/event-calendar?";
        
        // Add date range if provided
        if (fromDate && toDate) {
            url = `https://www.nseindia.com/api/event-calendar?index=equities&from_date=${fromDate}&to_date=${toDate}`;
        }

        logger.info({ msg: 'Fetching event calendar from NSE', fromDate, toDate });
        
        const data = await nseFetch(url) as any;
        const events = Array.isArray(data) ? data : (data?.data || []);

        // Cache for 1 hour
        const ttl = 3600;
        staticCache.set(cacheKey, events, ttl);

        logger.info({ msg: 'Event calendar fetched', count: events.length, fromDate, toDate });
        return events;
    } catch (e) {
        logger.error({ msg: 'Event calendar fetch error', fromDate, toDate, error: e });
        return [];
    }
}

/**
 * Get corporate financial results from NSE
 * API: https://www.nseindia.com/api/corporates-financial-results?index=equities&period=Quarterly
 */
export async function getCorporateResults(period: string = "Quarterly") {
    const cacheKey = `nse:corporateResults:${period}`;
    const cached = staticCache.get(cacheKey);
    if (cached) return cached;

    try {
        const url = `https://www.nseindia.com/api/corporates-financial-results?index=equities&period=${period}`;
        
        logger.info({ msg: 'Fetching corporate results from NSE', period });
        
        const data = await nseFetch(url) as any;
        const results = Array.isArray(data) ? data : (data?.data || []);

        // Cache for 1 hour
        const ttl = 3600;
        staticCache.set(cacheKey, results, ttl);

        logger.info({ msg: 'Corporate results fetched', count: results.length, period });
        return results;
    } catch (e) {
        logger.error({ msg: 'Corporate results fetch error', period, error: e });
        return [];
    }
}

/**
 * Get insider trading data from NSE
 * Daily: https://www.nseindia.com/api/cmsNote?url=corporate-filings-insider-trading
 * Historical: https://www.nseindia.com/api/corporates-pit?index=equities&from_date=13-03-2025&to_date=13-03-2026
 */
export async function getInsiderTrading(fromDate?: string, toDate?: string) {
    const cacheKey = `nse:insiderTrading:${fromDate || 'daily'}:${toDate || 'daily'}`;
    const cached = staticCache.get(cacheKey);
    if (cached) return cached;

    try {
        let url: string;
        
        if (fromDate && toDate) {
            // Historical data
            url = `https://www.nseindia.com/api/corporates-pit?index=equities&from_date=${fromDate}&to_date=${toDate}`;
        } else {
            // Daily data
            url = "https://www.nseindia.com/api/cmsNote?url=corporate-filings-insider-trading";
        }

        logger.info({ msg: 'Fetching insider trading from NSE', fromDate, toDate });
        
        const data = await nseFetch(url) as any;
        const insiderData = Array.isArray(data) ? data : (data?.data || []);

        // Cache for 1 hour
        const ttl = 3600;
        staticCache.set(cacheKey, insiderData, ttl);

        logger.info({ msg: 'Insider trading data fetched', count: insiderData.length, fromDate, toDate });
        return insiderData;
    } catch (e) {
        logger.error({ msg: 'Insider trading fetch error', fromDate, toDate, error: e });
        return [];
    }
}

/**
 * Get financial results comparison for a specific stock from NSE
 * API: https://www.nseindia.com/api/results-comparision?index=equities&symbol=ITC&issuer=ITC%20Limited
 */
export async function getFinancialResultsComparison(symbol: string, issuerName?: string) {
    const cacheKey = `nse:resultsComparison:${symbol}`;
    const cached = staticCache.get(cacheKey);
    if (cached) return cached;

    try {
        const params = new URLSearchParams({
            index: 'equities',
            symbol: symbol
        });
        
        if (issuerName) {
            params.set('issuer', issuerName);
        }
        
        const url = `https://www.nseindia.com/api/results-comparision?${params.toString()}`;
        
        logger.info({ msg: 'Fetching financial results comparison from NSE', symbol, issuerName });
        
        const data = await nseFetch(url) as any;
        
        // Cache for 1 hour
        const ttl = 3600;
        staticCache.set(cacheKey, data, ttl);

        logger.info({ msg: 'Financial results comparison fetched', symbol });
        return data;
    } catch (e) {
        logger.error({ msg: 'Financial results comparison fetch error', symbol, issuerName, error: e });
        return null;
    }
}

/**
 * Get list of stocks from NSE equity master
 * API: https://www.nseindia.com/api/equity-master
 */
export async function getEquityMaster() {
    const cacheKey = `nse:equityMaster`;
    const cached = staticCache.get(cacheKey);
    if (cached) return cached;

    try {
        const url = `https://www.nseindia.com/api/equity-master`;
        
        logger.info({ msg: 'Fetching equity master from NSE' });
        
        const data = await nseFetch(url) as any;
        
        // Cache for 24 hours
        const ttl = 86400;
        staticCache.set(cacheKey, data, ttl);

        logger.info({ msg: 'Equity master fetched' });
        return data;
    } catch (e) {
        logger.error({ msg: 'Equity master fetch error', error: e });
        return null;
    }
}

/**
 * Get list of stocks from NSE index (e.g., NIFTY TOTAL MARKET)
 * API: https://www.nseindia.com/api/equity-stockIndices?index=NIFTY%20TOTAL%20MARKET
 */
export async function getIndexStocks(indexName: string = "NIFTY TOTAL MARKET") {
    const cacheKey = `nse:indexStocks:${indexName.replace(/\s+/g, '_')}`;
    const cached = staticCache.get(cacheKey);
    if (cached) return cached;

    try {
        const encodedIndex = encodeURIComponent(indexName);
        const url = `https://www.nseindia.com/api/equity-stockIndices?index=${encodedIndex}`;
        
        logger.info({ msg: 'Fetching index stocks from NSE', index: indexName });
        
        const data = await nseFetch(url) as any;
        
        // Response format: { name, advance, timestamp, data: [...] }
        // The first item in data array is the index itself, rest are stocks
        const stocksData = data?.data || [];
        
        // Filter out the index itself (first item has symbol matching indexName)
        const stocks = stocksData.filter((item: any) => 
            item.symbol && item.symbol !== indexName && item.series === 'EQ'
        );
        
        // Cache for 1 hour
        const ttl = 3600;
        staticCache.set(cacheKey, stocks, ttl);

        logger.info({ msg: 'Index stocks fetched', index: indexName, count: stocks.length });
        return stocks;
    } catch (e) {
        logger.error({ msg: 'Index stocks fetch error', index: indexName, error: e });
        return null;
    }
}

/**
 * Sync stocks from NSE to local database
 */
export async function syncStocksToDatabase(indexName?: string) {
    try {
        let stocks: any[] = [];
        
        if (indexName) {
            // Fetch from specific index - getIndexStocks now returns just the stocks array
            const indexData = await getIndexStocks(indexName);
            stocks = Array.isArray(indexData) ? indexData : [];
        } else {
            // Fetch equity master
            const masterData = await getEquityMaster();
            stocks = masterData?.data || [];
        }
        
        if (stocks.length === 0) {
            return { success: false, message: "No stocks found from NSE" };
        }

        let synced = 0;
        let errors = 0;

        for (const stock of stocks) {
            try {
                const symbol = stock.symbol || stock.SYMBOL;
                if (!symbol) continue;

                // Company name can be in meta.companyName or directly in the object
                const companyName = stock.meta?.companyName || stock.companyName || stock.company_name || stock.issuerName || "";

                await prisma.symbol.upsert({
                    where: { symbol },
                    update: {
                        companyName,
                        series: stock.series || stock.SERIES || "EQ",
                        isActive: true,
                        updatedAt: new Date()
                    },
                    create: {
                        symbol,
                        companyName,
                        series: stock.series || stock.SERIES || "EQ",
                        isActive: true,
                    }
                });
                synced++;
            } catch (e) {
                errors++;
            }
        }

        logger.info({ msg: 'Stocks synced to database', indexName, synced, errors });
        return { success: true, synced, errors, total: stocks.length };
    } catch (e) {
        logger.error({ msg: 'Stock sync error', error: e });
        return { success: false, message: String(e) };
    }
}
