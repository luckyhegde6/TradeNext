import prisma from "@/lib/prisma";
import cache from "@/lib/cache"; // NodeCache
import { nseFetch } from "@/lib/nse-client";
import { MARKET_TIMINGS, MARKET_HOLIDAYS } from "@/lib/constants";

// Helper to check if market is currently open
function isMarketOpen() {
    const now = new Date();
    const day = now.getDay();
    const time = now.toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour12: false });

    // Weekend
    if (day === 0 || day === 6) return false;

    // Holiday
    const dateStr = now.toISOString().split("T")[0];
    if (MARKET_HOLIDAYS.includes(dateStr)) return false;

    // Time check (09:15 to 15:30)
    return time >= MARKET_TIMINGS.start && time <= MARKET_TIMINGS.end;
}

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

export async function getIndexChartData(indexName: string) {
    const cacheKey = `nse:index:${indexName}:chart:1D`;
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
        console.warn(`Database count query failed for ${indexName}:`, dbError.message || dbError);
        dbCount = 0; // Fallback to fetching from NSE
    }

    if (dbCount > 10) {
        const points = await prisma.indexPoint.findMany({
            where: { indexName: indexName, time: { gte: startOfDay, lte: endOfDay } },
            orderBy: { time: 'asc' }
        });
        const grapthData = points.map(p => [p.time.getTime(), Number(p.close)]);
        return { grapthData };
    }

    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const qs = `?functionName=getIndexChart&&index=${encodeURIComponent(indexName)}&flag=1D`;
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rawData = await nseFetch("/api/NextApi/apiClient/indexTrackerApi", qs) as any;

        const grapthData = rawData?.data?.grapthData || rawData?.grapthData || [];
        const normalizedData = { grapthData };
        cache.set(cacheKey, normalizedData, 3600);

        (async () => {
            try {
                const points = grapthData;
                if (Array.isArray(points) && points.length > 0) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const records = points.map((p: any) => ({
                        indexName,
                        time: new Date(p[0]),
                        close: p[1],
                    }));
                    await prisma.indexPoint.createMany({ data: records, skipDuplicates: true });
                }
            } catch (err) {
                console.error("Error hydrating index points:", err);
            }
        })();

        return normalizedData;
    } catch (e) {
        console.error("Failed to fetch index chart:", e);
        throw e;
    }
}

export async function getIndexDetails(indexName: string) {
    let dbQuote = null;
    try {
        // Add timeout to database query to prevent hanging
        const queryPromise = prisma.indexQuote.findUnique({ where: { indexName } });
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Database query timeout')), 5000)
        );

        dbQuote = await Promise.race([queryPromise, timeoutPromise]) as any;
        if (dbQuote && (Date.now() - dbQuote.updatedAt.getTime()) < 120000) {
            return dbQuote;
        }
    } catch (dbError) {
        console.warn(`Database query failed for ${indexName}, falling back to NSE:`, dbError.message || dbError);
        // Continue to fetch from NSE
    }

    const cacheKey = `nse:index:${indexName}:quote`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const qs = `?functionName=getIndexData&&index=${encodeURIComponent(indexName)}`;
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rawData = await nseFetch("/api/NextApi/apiClient/indexTrackerApi", qs) as any;
        const data = rawData?.data?.[0] || rawData?.[0] || {};

        const quote = {
            indexName: data.indexName || indexName,
            lastPrice: String(data.lastPrice || data.last || 0),
            change: String(data.lastPrice - data.previousClose || 0),
            pChange: String(data.percChange || data.percentChange || 0),
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

        cache.set(cacheKey, quote, 120);

        // Async database hydration (don't fail the request if DB is unavailable)
        (async () => {
            try {
                await prisma.indexQuote.upsert({
                    where: { indexName },
                    update: quote,
                    create: { ...quote, id: undefined }
                });
            } catch (err) {
                console.warn("DB upsert error (continuing without saving to DB):", err);
            }
        })();

        return quote;
    } catch (e) {
        console.error("Failed to fetch index details:", e);
        if (dbQuote) return dbQuote;
        throw e;
    }
}

export async function getIndexHeatmap(indexName: string) {
    const cacheKey = `nse:index:${indexName}:heatmap`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const qs = `?functionName=getConstituents&&index=${encodeURIComponent(indexName)}&&noofrecords=0`;
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rawData = await nseFetch("/api/NextApi/apiClient/indexTrackerApi", qs) as any;
        const items = rawData?.data || [];

        cache.set(cacheKey, items, 300); // 5 mins

        // Async Hydrate (don't fail the request if DB is unavailable)
        (async () => {
            try {
                for (const item of items) {
                    // Use cmSymbol as the symbol field
                    const symbol = item.cmSymbol || item.symbol;

                    // Skip if symbol is missing or undefined
                    if (!symbol) {
                        console.warn('Skipping item without symbol:', item);
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
                console.warn("Heatmap DB Hydration Error (continuing without saving to DB):", err);
            }
        })();

        return items;
    } catch (e) {
        console.error("Heatmap fetch error", e);
        // Fallback to DB
        const dbItems = await prisma.indexHeatmapItem.findMany({ where: { indexName } });
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
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const qs = `?functionName=getCorporateAction&&flag=CAC&&index=${encodeURIComponent(indexName)}`;
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rawData = await nseFetch("/api/NextApi/apiClient/indexTrackerApi", qs) as any;
        const data = rawData?.data || [];

        cache.set(cacheKey, data, 1800); // 30 mins
        return data;
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
    const cached = cache.get(cacheKey);
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

        cache.set(cacheKey, sorted, 1800); // 30 mins

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
    const cached = cache.get(cacheKey);
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
        cache.set(cacheKey, result, 300); // 5 minutes
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
