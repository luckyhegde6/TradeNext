import { NextResponse } from "next/server";
import { checkPriceAlerts, checkCorporateActionAlerts } from "@/lib/services/alertService";
import prisma from "@/lib/prisma";
import { getStockQuote } from "@/lib/stock-service";

export const dynamic = 'force-dynamic';

export async function POST() {
    try {
        // Check both Alert and UserAlert tables for price alerts
        const [systemAlerts, userAlerts] = await Promise.all([
            prisma.alert.findMany({
                where: {
                    triggered: false,
                    symbol: { not: null },
                    type: {
                        notIn: ["dividend_alert", "bonus_alert", "split_alert", "rights_alert", "buyback_alert", "meeting_alert"],
                    },
                },
                select: { id: true, symbol: true }
            }),
            prisma.userAlert.findMany({
                where: { status: "active" },
                select: { id: true, symbol: true, alertType: true, targetPrice: true, userId: true }
            })
        ]);

        // ... rest of existing code ...
        
        // Build symbol map for system alerts
        const symbolMap = new Map<string, string[]>();
        for (const alert of systemAlerts) {
            if (alert.symbol) {
                const existing = symbolMap.get(alert.symbol) || [];
                existing.push(alert.id);
                symbolMap.set(alert.symbol, existing);
            }
        }

        // Check system alerts
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

        // Check user alerts (price_above/price_below)
        const userAlertSymbols = [...new Set(userAlerts.map(a => a.symbol).filter((s): s is string => !!s))];
        
        for (const symbol of userAlertSymbols) {
            try {
                const quote = await getStockQuote(symbol);
                if (!quote?.lastPrice) continue;

                // Find triggered user alerts for this symbol
                const symbolUserAlerts = userAlerts.filter(a => a.symbol === symbol);
                
                for (const alert of symbolUserAlerts) {
                    const target = alert.targetPrice?.toNumber() || 0;
                    let triggered = false;
                    
                    if (alert.alertType === "price_above" && quote.lastPrice > target) {
                        triggered = true;
                    } else if (alert.alertType === "price_below" && quote.lastPrice < target) {
                        triggered = true;
                    }

                    if (triggered && alert.userId) {
                        // Update alert status
                        await prisma.userAlert.update({
                            where: { id: alert.id },
                            data: { status: "triggered", triggeredAt: new Date(), currentPrice: quote.lastPrice }
                        });

                        // Create notification
                        await prisma.notification.create({
                            data: {
                                userId: alert.userId,
                                type: "alert_triggered",
                                title: `Alert: ${symbol} price target reached`,
                                message: `${symbol} hit your ${alert.alertType === "price_above" ? "above" : "below"} target of ₹${target}. Current price: ₹${quote.lastPrice}`,
                                link: `/company/${symbol}`,
                            }
                        });

                        triggeredCount++;
                    }
                }
            } catch (err) {
                console.error(`Failed to check user alerts for ${symbol}:`, err);
            }
        }

        // Check corporate action alerts
        const corpActionResult = await checkCorporateActionAlerts();

        return NextResponse.json({ 
            success: true, 
            checked: symbolMap.size + userAlertSymbols.length + corpActionResult.checked,
            triggered: triggeredCount + corpActionResult.triggered,
            corporateActionTriggered: corpActionResult.triggered,
        });
    } catch (err) {
        console.error('Check alerts error:', err);
        return NextResponse.json({ error: 'Failed to check alerts' }, { status: 500 });
    }
}
