import { NextResponse } from "next/server";
import { checkPriceAlerts } from "@/lib/services/alertService";
import prisma from "@/lib/prisma";
import { getStockQuote } from "@/lib/stock-service";

export const dynamic = 'force-dynamic';

export async function POST() {
    try {
        const alerts = await prisma.alert.findMany({
            where: {
                triggered: false,
                symbol: { not: null },
            },
            select: {
                id: true,
                symbol: true,
            }
        });

        const symbolMap = new Map<string, string[]>();
        for (const alert of alerts) {
            if (alert.symbol) {
                const existing = symbolMap.get(alert.symbol) || [];
                existing.push(alert.id);
                symbolMap.set(alert.symbol, existing);
            }
        }

        let triggeredCount = 0;
        for (const [symbol, alertIds] of symbolMap) {
            try {
                const quote = await getStockQuote(symbol);
                if (quote && quote.lastPrice) {
                    const previousPrice = quote.lastPrice - (quote.change || 0);
                    await checkPriceAlerts(symbol, quote.lastPrice, previousPrice);
                    triggeredCount += alertIds.length;
                }
            } catch (err) {
                console.error(`Failed to check alerts for ${symbol}:`, err);
            }
        }

        return NextResponse.json({ 
            success: true, 
            checked: symbolMap.size,
            triggered: triggeredCount 
        });
    } catch (err) {
        console.error('Check alerts error:', err);
        return NextResponse.json({ error: 'Failed to check alerts' }, { status: 500 });
    }
}
