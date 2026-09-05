import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getIndexStocks, syncStocksToDatabase } from "@/lib/index-service";
import { searchNseSymbols } from "@/lib/services/nseScripList";
import { mergeSymbolSuggestions } from "@/lib/services/symbolReference";
import logger from "@/lib/logger";

export const runtime = "nodejs";

async function createAdminNotification(title: string, message: string) {
    try {
        // Find admin users
        const adminUsers = await prisma.user.findMany({
            where: { role: 'admin' },
            select: { id: true }
        });

        for (const admin of adminUsers) {
            await prisma.notification.create({
                data: {
                    userId: admin.id,
                    title,
                    message,
                    type: 'SYSTEM',
                    isRead: false,
                }
            });
        }
    } catch (e) {
        logger.error({ msg: "Failed to create admin notification", error: e });
    }
}

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const query = searchParams.get("q");

        if (!query || query.length < 1) {
            return NextResponse.json({ symbols: [] });
        }

        const search = query.toUpperCase();

        // Constant first — the committed NSE equity-scrip reference
        // (2,570 scrips, SYMBOL-prefix priority). Covers fresh listings and
        // BE/BZ-series symbols not yet in the `symbols` table without any
        // NSE round-trip or DB write. DB rows supplement + dedupe below.
        const constantMatches = searchNseSymbols(search, 15);

        // Supplement from database
        const dbMatches = await prisma.symbol.findMany({
            where: {
                OR: [
                    { symbol: { contains: search } },
                    { companyName: { contains: query, mode: 'insensitive' } },
                ],
                isActive: true,
            },
            take: 15,
            select: {
                symbol: true,
                companyName: true,
            },
            orderBy: [
                { symbol: 'asc' }
            ]
        });

        const symbols = mergeSymbolSuggestions(constantMatches, dbMatches, 15);

        // If we have results, return them (constant / db / merged)
        if (symbols.length > 0) {
            const source = constantMatches.length > 0 && dbMatches.length > 0
                ? 'merged'
                : constantMatches.length > 0 ? 'constant' : 'db';
            return NextResponse.json({ symbols, source });
        }

        // No results in DB - try to fetch from NSE and sync
        logger.info({ msg: "No symbols found in DB, fetching from NSE", query });

        try {
            // Fetch from NIFTY TOTAL MARKET
            const nseData = await getIndexStocks("NIFTY TOTAL MARKET");
            
            if (nseData && Array.isArray(nseData)) {
                // Sync to database
                await syncStocksToDatabase("NIFTY TOTAL MARKET");
                
                // Try again from database after sync
                const refreshedSymbols = await prisma.symbol.findMany({
                    where: {
                        OR: [
                            { symbol: { contains: search } },
                            { companyName: { contains: query, mode: 'insensitive' } },
                        ],
                        isActive: true,
                    },
                    take: 15,
                    select: {
                        symbol: true,
                        companyName: true,
                    },
                    orderBy: [
                        { symbol: 'asc' }
                    ]
                });

                if (refreshedSymbols.length > 0) {
                    return NextResponse.json({ symbols: refreshedSymbols, source: 'nse' });
                }
            }
        } catch (nseError) {
            logger.error({ msg: "NSE fetch failed in autocomplete", query, error: nseError });
            
            // Create admin notification for manual sync
            await createAdminNotification(
                'Stock Database Empty',
                `Symbol search for "${query}" failed. Please sync stock list from NSE admin panel.`
            );
        }

        return NextResponse.json({ 
            symbols: [], 
            source: 'none',
            message: 'No symbols found. Please sync stock list from admin panel.',
            requiresSync: true
        });
    } catch (error) {
        logger.error({ msg: "Symbol search error", error });
        return NextResponse.json({ error: "Search failed" }, { status: 500 });
    }
}
