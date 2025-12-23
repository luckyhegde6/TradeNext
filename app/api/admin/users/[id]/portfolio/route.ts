import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";

// GET - Get user's portfolio data (admin delegated access)
export async function GET(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await auth();

        if (!session || !session.user || session.user.role !== 'admin') {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id } = await params;
        const userId = parseInt(id);

        if (isNaN(userId)) {
            return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
        }

        // Get user info
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                name: true,
                email: true
            }
        });

        if (!user) {
            return NextResponse.json({ error: "User not found" }, { status: 404 });
        }

        // Get user's portfolios with transactions
        const portfolios = await prisma.portfolio.findMany({
            where: { userId },
            include: {
                transactions: {
                    orderBy: { tradeDate: 'desc' }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        // Calculate holdings from transactions (simplified - assuming buy transactions only)
        const portfoliosWithHoldings = portfolios.map(portfolio => {
            // Group transactions by ticker to calculate holdings
            const holdingsMap = new Map<string, any>();

            portfolio.transactions.forEach(transaction => {
                const ticker = transaction.ticker;
                if (!holdingsMap.has(ticker)) {
                    holdingsMap.set(ticker, {
                        symbol: ticker,
                        quantity: 0,
                        totalCost: 0,
                        averagePrice: 0,
                        lastTradeDate: transaction.tradeDate
                    });
                }

                const holding = holdingsMap.get(ticker);
                if (transaction.side === 'BUY' || transaction.side === 'buy') {
                    holding.quantity += Number(transaction.quantity);
                    holding.totalCost += Number(transaction.quantity) * Number(transaction.price);
                } else if (transaction.side === 'SELL' || transaction.side === 'sell') {
                    holding.quantity -= Number(transaction.quantity);
                    holding.totalCost -= Number(transaction.quantity) * Number(transaction.price);
                }

                if (holding.quantity > 0) {
                    holding.averagePrice = holding.totalCost / holding.quantity;
                }
            });

            // Convert map to array and filter out zero positions
            const holdings = Array.from(holdingsMap.values())
                .filter(holding => holding.quantity > 0)
                .map(holding => ({
                    ...holding,
                    quantity: holding.quantity,
                    averagePrice: holding.averagePrice,
                    // Mock stock data since we don't have it in schema
                    stock: {
                        symbol: holding.symbol,
                        name: holding.symbol, // Placeholder
                        sector: 'Unknown', // Placeholder
                        industry: 'Unknown' // Placeholder
                    }
                }))
                .sort((a, b) => b.quantity - a.quantity);

            const totalValue = holdings.reduce((sum, holding) => {
                return sum + (holding.quantity * holding.averagePrice);
            }, 0);

            const totalStocks = holdings.length;
            const sectors = [...new Set(holdings.map(h => h.stock.sector).filter(Boolean))];

            return {
                ...portfolio,
                holdings,
                stats: {
                    totalValue,
                    totalStocks,
                    sectors: sectors.length,
                    sectorList: sectors
                }
            };
        });

        return NextResponse.json({
            user,
            portfolios: portfoliosWithHoldings,
            meta: {
                fetchedAt: new Date().toISOString(),
                stale: false,
              },
        });
    } catch (error) {
        console.error('Admin user portfolio GET error:', error);
        return NextResponse.json({ error: "Failed to fetch user portfolio" }, { status: 500 });
    }
}
